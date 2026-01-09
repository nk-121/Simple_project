
import mongoose from 'mongoose';

// User Model

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['customer', 'seller'], required: true },
  phone: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Shop Model with Geospatial Index
const shopSchema = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: String,
  category: { type: String, required: true },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  address: { type: String, required: true },
  phone: String,
  rating: { type: Number, default: 0, min: 0, max: 5 },
  totalReviews: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  openingHours: String,
  createdAt: { type: Date, default: Date.now }
});

// Create geospatial index for location-based queries
shopSchema.index({ location: '2dsphere' });
shopSchema.index({ name: 'text', description: 'text', category: 'text' });

const Shop = mongoose.model('Shop', shopSchema);

// Product/Service Model
const productSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
  name: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  category: String,
  availability: { type: Boolean, default: true },
  imageUrl: String,
  createdAt: { type: Date, default: Date.now }
});

productSchema.index({ name: 'text', description: 'text' });

const Product = mongoose.model('Product', productSchema);

// Review Model
const reviewSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: String,
  createdAt: { type: Date, default: Date.now }
});

const Review = mongoose.model('Review', reviewSchema);

class SearchService {
  /**
   * Search for nearby shops based on location and radius
   * @param {number} latitude - User's latitude
   * @param {number} longitude - User's longitude
   * @param {number} radiusInKm - Search radius in kilometers
   * @param {string} query - Optional search query for shop name/category
   * @param {string} sortBy - Sort option: 'distance', 'rating'
   */
  async searchNearbyShops({ latitude, longitude, radiusInKm = 5, query = '', sortBy = 'rating' }) {
    const radiusInMeters = radiusInKm * 1000;

    // Build the query
    const searchQuery = {
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          $maxDistance: radiusInMeters
        }
      },
      isActive: true
    };

    // Add text search if query provided
    if (query) {
      searchQuery.$text = { $search: query };
    }

    // Execute search
    let shops = await Shop.find(searchQuery)
      .select('name description category location address phone rating totalReviews')
      .lean();

    // Calculate distance for each shop
    shops = shops.map(shop => {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        shop.location.coordinates[1],
        shop.location.coordinates[0]
      );
      return { ...shop, distance: parseFloat(distance.toFixed(2)) };
    });

    // Sort results
    if (sortBy === 'distance') {
      shops.sort((a, b) => a.distance - b.distance);
    } else if (sortBy === 'rating') {
      shops.sort((a, b) => b.rating - a.rating);
    }

    return shops;
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Search products across nearby shops
   */
  async searchProducts({ latitude, longitude, radiusInKm = 5, productQuery = '' }) {
    const radiusInMeters = radiusInKm * 1000;

    // First, find nearby shops
    const nearbyShops = await Shop.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          $maxDistance: radiusInMeters
        }
      },
      isActive: true
    }).select('_id name location');

    const shopIds = nearbyShops.map(shop => shop._id);

    // Then search for products in those shops
    const productSearchQuery = {
      shopId: { $in: shopIds },
      availability: true
    };

    if (productQuery) {
      productSearchQuery.$text = { $search: productQuery };
    }

    const products = await Product.find(productSearchQuery)
      .populate('shopId', 'name address rating location')
      .lean();

    // Add distance to each product based on shop location
    return products.map(product => {
      const shop = nearbyShops.find(s => s._id.equals(product.shopId._id));
      const distance = this.calculateDistance(
        latitude,
        longitude,
        shop.location.coordinates[1],
        shop.location.coordinates[0]
      );
      return { ...product, distance: parseFloat(distance.toFixed(2)) };
    }).sort((a, b) => a.distance - b.distance);
  }
}

export { SearchService, User, Shop, Product, Review };
