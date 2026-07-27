-- CreateEnum
CREATE TYPE "Layer" AS ENUM ('L1', 'L2', 'L3', 'IC');

-- CreateEnum
CREATE TYPE "ScoreType" AS ENUM ('scale', 'binary');

-- CreateEnum
CREATE TYPE "ObservationStatus" AS ENUM ('draft', 'accepted', 'edited', 'rejected');

-- CreateEnum
CREATE TYPE "OriginTag" AS ENUM ('founder-volunteered', 'founder-confirmed-after-PM-framing', 'machine-inferred');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('claimed', 'validated', 'refuted');

-- CreateEnum
CREATE TYPE "Lens" AS ENUM ('peak', 'weakest-link');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PM', 'PARTNER', 'ADMIN');

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "oneLiner" TEXT NOT NULL,
    "founders" TEXT NOT NULL,
    "ownerPm" TEXT NOT NULL,
    "opened" TIMESTAMP(3) NOT NULL,
    "layer" "Layer" NOT NULL DEFAULT 'L1',
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "transcript" TEXT NOT NULL,
    "extracted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "callNumber" INTEGER NOT NULL,
    "rubricKey" TEXT NOT NULL,
    "subDimensionKey" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "speaker" TEXT,
    "timestamp" TEXT,
    "status" "ObservationStatus" NOT NULL DEFAULT 'draft',
    "layer" "Layer" NOT NULL DEFAULT 'L1',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "originTag" "OriginTag" NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'claimed',
    "anchorObsId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubDimensionScore" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "subDimensionKey" TEXT NOT NULL,
    "scoreType" "ScoreType" NOT NULL,
    "value" TEXT NOT NULL,
    "flag" BOOLEAN NOT NULL DEFAULT false,
    "layer" "Layer" NOT NULL DEFAULT 'L1',
    "rubricVersion" TEXT NOT NULL DEFAULT 'v1',
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubDimensionScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreEvidence" (
    "scoreId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreEvidence_pkey" PRIMARY KEY ("scoreId","observationId")
);

-- CreateTable
CREATE TABLE "Slide" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "slideKey" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "provisionalValue" INTEGER,
    "lens" "Lens" NOT NULL,
    "ceilingGuard" TEXT NOT NULL,
    "layer" "Layer" NOT NULL DEFAULT 'L1',
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Slide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FounderTypeRead" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "primary" TEXT NOT NULL,
    "secondary" TEXT,
    "profile" TEXT NOT NULL,
    "floorDimension" TEXT NOT NULL,
    "pmConfirmation" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FounderTypeRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'PM',
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "Deal_ownerId_idx" ON "Deal"("ownerId");

-- CreateIndex
CREATE INDEX "Call_dealId_idx" ON "Call"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_dealId_number_key" ON "Call"("dealId", "number");

-- CreateIndex
CREATE INDEX "Observation_dealId_subDimensionKey_idx" ON "Observation"("dealId", "subDimensionKey");

-- CreateIndex
CREATE INDEX "Observation_dealId_callNumber_idx" ON "Observation"("dealId", "callNumber");

-- CreateIndex
CREATE INDEX "Observation_decidedById_idx" ON "Observation"("decidedById");

-- CreateIndex
CREATE INDEX "Claim_dealId_idx" ON "Claim"("dealId");

-- CreateIndex
CREATE INDEX "Claim_anchorObsId_idx" ON "Claim"("anchorObsId");

-- CreateIndex
CREATE INDEX "SubDimensionScore_dealId_idx" ON "SubDimensionScore"("dealId");

-- CreateIndex
CREATE INDEX "SubDimensionScore_authorId_idx" ON "SubDimensionScore"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "SubDimensionScore_dealId_subDimensionKey_layer_key" ON "SubDimensionScore"("dealId", "subDimensionKey", "layer");

-- CreateIndex
CREATE INDEX "ScoreEvidence_observationId_idx" ON "ScoreEvidence"("observationId");

-- CreateIndex
CREATE INDEX "Slide_dealId_idx" ON "Slide"("dealId");

-- CreateIndex
CREATE INDEX "Slide_authorId_idx" ON "Slide"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "Slide_dealId_slideKey_layer_key" ON "Slide"("dealId", "slideKey", "layer");

-- CreateIndex
CREATE UNIQUE INDEX "FounderTypeRead_dealId_key" ON "FounderTypeRead"("dealId");

-- CreateIndex
CREATE INDEX "FounderTypeRead_authorId_idx" ON "FounderTypeRead"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_anchorObsId_fkey" FOREIGN KEY ("anchorObsId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubDimensionScore" ADD CONSTRAINT "SubDimensionScore_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubDimensionScore" ADD CONSTRAINT "SubDimensionScore_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEvidence" ADD CONSTRAINT "ScoreEvidence_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "SubDimensionScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEvidence" ADD CONSTRAINT "ScoreEvidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slide" ADD CONSTRAINT "Slide_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slide" ADD CONSTRAINT "Slide_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FounderTypeRead" ADD CONSTRAINT "FounderTypeRead_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FounderTypeRead" ADD CONSTRAINT "FounderTypeRead_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain integrity Prisma cannot express in the schema language.

-- A score's stored value must belong to the value set its scoreType declares.
-- Keeps the (scoreType, value) pair honest even against a raw SQL write.
ALTER TABLE "SubDimensionScore"
  ADD CONSTRAINT "score_value_matches_type" CHECK (
    ("scoreType" = 'scale'  AND "value" IN ('1', '2', '3', '4', '5', 'NE')) OR
    ("scoreType" = 'binary' AND "value" IN ('pass', 'unv', 'fail'))
  );

-- Slides live on 0..10 and nowhere else. The L1 cap on the *banked* value is a
-- domain rule (lib/domain/rules.ts), not a constraint, because a provisional
-- read is allowed to exceed it.
ALTER TABLE "Slide"
  ADD CONSTRAINT "slide_value_in_range" CHECK ("value" BETWEEN 0 AND 10);

ALTER TABLE "Slide"
  ADD CONSTRAINT "slide_provisional_in_range" CHECK (
    "provisionalValue" IS NULL OR "provisionalValue" BETWEEN 0 AND 10
  );

-- A provisional read is a *higher* read pending verification; it may never sit
-- below the value already banked.
ALTER TABLE "Slide"
  ADD CONSTRAINT "slide_provisional_not_below_banked" CHECK (
    "provisionalValue" IS NULL OR "provisionalValue" >= "value"
  );

-- The ceiling guard is required prose, not an empty string (spec §4.3).
ALTER TABLE "Slide"
  ADD CONSTRAINT "slide_ceiling_guard_present" CHECK (length(btrim("ceilingGuard")) > 0);

-- Call numbering starts at 1.
ALTER TABLE "Call"
  ADD CONSTRAINT "call_number_positive" CHECK ("number" >= 1);
