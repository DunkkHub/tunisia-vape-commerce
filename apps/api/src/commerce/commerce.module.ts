import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
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
import { DeliveryOptionsController, GeographyController } from '../geography/geography.controller';
import { GeographyService } from '../geography/geography.service';
import { AdminBrandsController, AdminCategoriesController } from '../taxonomy/taxonomy.controller';
import { AdminBrandsService, AdminCategoriesService } from '../taxonomy/taxonomy.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CatalogController,
    StorefrontCatalogController,
    AdminProductsController,
    AdminVariantsController,
    CheckoutController,
    AgeGateController,
    CartController,
    GeographyController,
    DeliveryOptionsController,
    CustomerOrdersController,
    AdminBrandsController,
    AdminCategoriesController,
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
    AdminBrandsService,
    AdminCategoriesService,
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
