-- CreateTable
CREATE TABLE "RecordAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordAttachment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecordAttachment_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RecordAttachment_recordId_createdAt_idx" ON "RecordAttachment"("recordId", "createdAt");

-- CreateIndex
CREATE INDEX "RecordAttachment_fileName_idx" ON "RecordAttachment"("fileName");

-- CreateIndex
CREATE INDEX "RecordAttachment_uploadedBy_idx" ON "RecordAttachment"("uploadedBy");
