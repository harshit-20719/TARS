-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "importedByEmail" TEXT,
ADD COLUMN     "importedById" TEXT,
ADD COLUMN     "sourceMeetingId" TEXT;

-- CreateIndex
CREATE INDEX "Call_importedById_idx" ON "Call"("importedById");

-- CreateIndex
CREATE INDEX "Call_dealId_sourceMeetingId_idx" ON "Call"("dealId", "sourceMeetingId");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
