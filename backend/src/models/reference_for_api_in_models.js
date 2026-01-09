

// ============================================
// 3. API ROUTES (Express.js)
// ============================================

const express = require('express');
const router = express.Router();
const searchService = new SearchService();

// Authentication middleware (implement as needed)
const authenticate = (req, res, next) => {
  // Add your JWT authentication logic here
  next();
};

// SEARCH ENDPOINTS

/**
 * GET /api/search/shops
 * Search for nearby shops
 */
router.get('/search/shops', async (req, res) => {
  try {
    const { lat, lng, radius, query, sortBy } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const results = await searchService.searchNearbyShops({
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      radiusInKm: radius ? parseFloat(radius) : 5,
      query: query || '',
      sortBy: sortBy || 'rating'
    });

    res.json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/search/products
 * Search for products in nearby shops
 */
router.get('/search/products', async (req, res) => {
  try {
    const { lat, lng, radius, query } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const results = await searchService.searchProducts({
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      radiusInKm: radius ? parseFloat(radius) : 5,
      productQuery: query || ''
    });

    res.json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('Product search error:', error);
    res.status(500).json({ error: 'Product search failed' });
  }
});

/**
 * GET /api/shops/:id
 * Get detailed shop information
 */
router.get('/shops/:id', async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id)
      .populate('sellerId', 'name email phone');

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const products = await Product.find({ shopId: shop._id, availability: true });
    const reviews = await Review.find({ shopId: shop._id })
      .populate('customerId', 'name')
      .sort('-createdAt')
      .limit(10);

    res.json({
      success: true,
      data: {
        shop,
        products,
        reviews
      }
    });
  } catch (error) {
    console.error('Shop fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch shop details' });
  }
});

// SELLER ENDPOINTS

/**
 * POST /api/shops
 * Create a new shop (sellers only)
 */
router.post('/shops', authenticate, async (req, res) => {
  try {
    const { name, description, category, latitude, longitude, address, phone, openingHours } = req.body;

    // Verify user is a seller
    const user = await User.findById(req.user.id);
    if (user.role !== 'seller') {
      return res.status(403).json({ error: 'Only sellers can create shops' });
    }

    const shop = new Shop({
      sellerId: req.user.id,
      name,
      description,
      category,
      location: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      address,
      phone,
      openingHours
    });

    await shop.save();

    res.status(201).json({
      success: true,
      data: shop
    });
  } catch (error) {
    console.error('Shop creation error:', error);
    res.status(500).json({ error: 'Failed to create shop' });
  }
});

/**
 * PUT /api/shops/:id
 * Update shop details (sellers only)
 */
router.put('/shops/:id', authenticate, async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Verify ownership
    if (shop.sellerId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to update this shop' });
    }

    const updates = req.body;
    
    // Update location if latitude and longitude provided
    if (updates.latitude && updates.longitude) {
      shop.location = {
        type: 'Point',
        coordinates: [updates.longitude, updates.latitude]
      };
      delete updates.latitude;
      delete updates.longitude;
    }

    Object.assign(shop, updates);
    await shop.save();

    res.json({
      success: true,
      data: shop
    });
  } catch (error) {
    console.error('Shop update error:', error);
    res.status(500).json({ error: 'Failed to update shop' });
  }
});

/**
 * POST /api/shops/:id/products
 * Add product/service to shop
 */
router.post('/shops/:id/products', authenticate, async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (shop.sellerId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const product = new Product({
      shopId: shop._id,
      ...req.body
    });

    await product.save();

    res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Product creation error:', error);
    res.status(500).json({ error: 'Failed to add product' });
  }
});

// REVIEW ENDPOINTS

/**
 * POST /api/shops/:id/reviews
 * Add review to a shop
 */
router.post('/shops/:id/reviews', authenticate, async (req, res) => {
  try {
    const { rating, comment } = req.body;

    // Verify user is a customer
    const user = await User.findById(req.user.id);
    if (user.role !== 'customer') {
      return res.status(403).json({ error: 'Only customers can leave reviews' });
    }

    const shop = await Shop.findById(req.params.id);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Check if user already reviewed this shop
    const existingReview = await Review.findOne({
      shopId: shop._id,
      customerId: req.user.id
    });

    if (existingReview) {
      return res.status(400).json({ error: 'You have already reviewed this shop' });
    }

    const review = new Review({
      shopId: shop._id,
      customerId: req.user.id,
      rating,
      comment
    });

    await review.save();

    // Update shop rating
    const reviews = await Review.find({ shopId: shop._id });
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    
    shop.rating = avgRating;
    shop.totalReviews = reviews.length;
    await shop.save();

    res.status(201).json({
      success: true,
      data: review
    });
  } catch (error) {
    console.error('Review creation error:', error);
    res.status(500).json({ error: 'Failed to add review' });
  }
});

/**
 * GET /api/shops/:id/reviews
 * Get all reviews for a shop
 */
router.get('/shops/:id/reviews', async (req, res) => {
  try {
    const reviews = await Review.find({ shopId: req.params.id })
      .populate('customerId', 'name')
      .sort('-createdAt');

    res.json({
      success: true,
      count: reviews.length,
      data: reviews
    });
  } catch (error) {
    console.error('Reviews fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// ============================================
// 4. SERVER SETUP
// ============================================

const app = express();
const cors = require('cors');

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', router);

// Database connection
mongoose.connect(process.env.DATABASE_URL || 'mongodb://localhost:27017/hyperlocal', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Database connected'))
.catch(err => console.error('❌ Database connection error:', err));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ============================================
// 5. EXAMPLE USAGE / CLIENT CODE
// ============================================

// Example: Searching for nearby shops
async function searchNearbyShops(latitude, longitude, radius = 5) {
  try {
    const response = await fetch(
      `http://localhost:3000/api/search/shops?lat=${latitude}&lng=${longitude}&radius=${radius}&sortBy=rating`
    );
    const data = await response.json();
    console.log('Nearby shops:', data);
    return data;
  } catch (error) {
    console.error('Search failed:', error);
  }
}

// Example: Searching for products
async function searchProducts(latitude, longitude, query) {
  try {
    const response = await fetch(
      `http://localhost:3000/api/search/products?lat=${latitude}&lng=${longitude}&query=${encodeURIComponent(query)}`
    );
    const data = await response.json();
    console.log('Products found:', data);
    return data;
  } catch (error) {
    console.error('Product search failed:', error);
  }
}

// Example: Creating a shop
async function createShop(token, shopData) {
  try {
    const response = await fetch('http://localhost:3000/api/shops', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(shopData)
    });
    const data = await response.json();
    console.log('Shop created:', data);
    return data;
  } catch (error) {
    console.error('Shop creation failed:', error);
  }
}

module.exports = { app, router, SearchService, User, Shop, Product, Review };