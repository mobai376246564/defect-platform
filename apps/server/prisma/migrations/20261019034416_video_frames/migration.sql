-- CreateTable
CREATE TABLE "VideoFrame" (
    "id" UUID NOT NULL,
    "attachmentId" UUID NOT NULL,
    "tsMs" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "nearMark" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VideoFrame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoFrame_attachmentId_tsMs_key" ON "VideoFrame"("attachmentId", "tsMs");

-- AddForeignKey
ALTER TABLE "VideoFrame" ADD CONSTRAINT "VideoFrame_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
