-- AlterTable
ALTER TABLE "introducing_brokers" ADD COLUMN "buyFeeRateBps" INTEGER;
ALTER TABLE "introducing_brokers" ADD COLUMN "sellFeeRateBps" INTEGER;
ALTER TABLE "introducing_brokers" ADD COLUMN "sellTaxRateBps" INTEGER;
