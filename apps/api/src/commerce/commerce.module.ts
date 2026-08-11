import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { CatalogImportController } from '../catalog-import/catalog-import.controller';
import { CatalogMediaImportService } from '../catalog-import/catalog-media-import.service';
import { CatalogImportService } from '../catalog-import/catalog-import.service';
import { AdminProductsController } from '../catalog/admin-products.controller';
import { AdminProductsService } from '../catalog/admin-products.service';
import { AdminVariantsController } from '../catalog/admin-variants.controller';
import { AdminVariantsService } from '../catalog/admin-variants.service';
import { CatalogController } from '../catalog/catalog.controller';
import { CatalogService } from '../catalog/catalog.service';
import { StorefrontCatalogController } from '../catalog/storefront-catalog.controller';
import { CartController } from '../cart/cart.controller';
import { CartService } from '../cart/cart.service';
import { CheckoutController } from '../checkout/checkout.controller';
import { CheckoutOrderService } from '../checkout/checkout-order.service';
import { CheckoutPolicyService } from '../checkout/checkout-policy.service';
import { CheckoutQuoteService } from '../checkout/checkout-quote.service';
import { AgeGateController } from '../compliance/age-gate.controller';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { AgeGateService } from '../compliance/age-gate.service';
import { CustomerOrdersController } from '../customer-orders/customer-orders.controller';
import { CustomerOrdersService } from '../customer-orders/customer-orders.service';
import { CustomerAddressesController } from '../customer-addresses/customer-addresses.controller';
import { CustomerAddressesService } from '../customer-addresses/customer-addresses.service';
import { AdminDeliveryGeographyController } from '../geography/admin-delivery-geography.controller';
import { DeliveryOptionsController, GeographyController } from '../geography/geography.controller';
import { GeographyService } from '../geography/geography.service';
import {
  AdminProductMediaController,
  PublicProductMediaController,
} from '../product-media/product-media.controller';
import { ProductImageValidatorService } from '../product-media/product-image-validator.service';
import { productMediaMulterOptions } from '../product-media/product-media-multipart.options';
import { ProductMediaService } from '../product-media/product-media.service';
import { ProductMediaUploadGateInterceptor } from '../product-media/product-media-upload-gate.interceptor';
import { productMediaStorageProvider } from '../product-media/storage/media-storage.provider';
import {
  LegalDocumentsController,
  StorefrontContentController,
} from '../storefront-content/storefront-content.controller';
import { StorefrontContentService } from '../storefront-content/storefront-content.service';
import { AdminBrandsController, AdminCategoriesController } from '../taxonomy/taxonomy.controller';
import { AdminBrandsService, AdminCategoriesService } from '../taxonomy/taxonomy.service';
import { WishlistController } from '../wishlist/wishlist.controller';
import { WishlistService } from '../wishlist/wishlist.service';

@Module({
  imports: [
    AuthModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: productMediaMulterOptions,
    }),
  ],
  controllers: [
    CatalogController,
    StorefrontCatalogController,
    AdminProductsController,
    AdminVariantsController,
    CheckoutController,
    AgeGateController,
    CartController,
    AdminDeliveryGeographyController,
    GeographyController,
    DeliveryOptionsController,
    CustomerOrdersController,
    CustomerAddressesController,
    WishlistController,
    LegalDocumentsController,
    StorefrontContentController,
    AdminProductMediaController,
    PublicProductMediaController,
    AdminBrandsController,
    AdminCategoriesController,
    CatalogImportController,
  ],
  providers: [
    CatalogService,
    AdminProductsService,
    AdminVariantsService,
    CheckoutPolicyService,
    CheckoutQuoteService,
    CheckoutOrderService,
    AgeGateService,
    AgeGateGuard,
    CartService,
    GeographyService,
    CustomerOrdersService,
    CustomerAddressesService,
    WishlistService,
    StorefrontContentService,
    ProductImageValidatorService,
    ProductMediaUploadGateInterceptor,
    productMediaStorageProvider,
    ProductMediaService,
    AdminBrandsService,
    AdminCategoriesService,
    CatalogImportService,
    CatalogMediaImportService,
  ],
  exports: [
    CatalogService,
    CheckoutPolicyService,
    CheckoutQuoteService,
    CheckoutOrderService,
    AgeGateService,
    CartService,
    GeographyService,
    CustomerOrdersService,
  ],
})
export class CommerceModule {}
