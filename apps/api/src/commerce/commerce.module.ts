import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminProductsController } from '../catalog/admin-products.controller';
import { AdminProductsService } from '../catalog/admin-products.service';
import { CatalogController } from '../catalog/catalog.controller';
import { CatalogService } from '../catalog/catalog.service';
import { StorefrontCatalogController } from '../catalog/storefront-catalog.controller';
import { CheckoutController } from '../checkout/checkout.controller';
import { CheckoutPolicyService } from '../checkout/checkout-policy.service';
import { CheckoutQuoteService } from '../checkout/checkout-quote.service';
import { AgeGateController } from '../compliance/age-gate.controller';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { AgeGateService } from '../compliance/age-gate.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CatalogController,
    StorefrontCatalogController,
    AdminProductsController,
    CheckoutController,
    AgeGateController,
  ],
  providers: [
    CatalogService,
    AdminProductsService,
    CheckoutPolicyService,
    CheckoutQuoteService,
    AgeGateService,
    AgeGateGuard,
  ],
  exports: [CatalogService, CheckoutPolicyService, CheckoutQuoteService, AgeGateService],
})
export class CommerceModule {}
