-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentWorkspaceId" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_currentWorkspaceId_fkey" FOREIGN KEY ("currentWorkspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Mon espace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "columns" TEXT NOT NULL DEFAULT '[]',
    "kanbanGroupProperty" TEXT,
    "sections" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Template_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'private',
    "icon" TEXT,
    "position" REAL NOT NULL DEFAULT 0,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "Section_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'Sans titre',
    "content" TEXT NOT NULL DEFAULT '[]',
    "icon" TEXT,
    "parentId" TEXT,
    "position" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sectionId" TEXT,
    "ownerId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'team',
    "trashedAt" DATETIME,
    CONSTRAINT "Page_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Page_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Page_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Page_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PageVisit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "visitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PageVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PageVisit_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Database" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "recordTemplate" TEXT,
    "templateId" TEXT,
    "recordSections" TEXT,
    "patchNotesPageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Database_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DatabaseProperty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "databaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" REAL NOT NULL DEFAULT 0,
    "config" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "DatabaseProperty_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "databaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Sans titre',
    "icon" TEXT,
    "coverUrl" TEXT,
    "content" TEXT NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "position" REAL NOT NULL DEFAULT 0,
    "properties" TEXT NOT NULL DEFAULT '{}',
    "templateId" TEXT,
    "sectionsBody" TEXT,
    "sprintId" TEXT,
    "trashedAt" DATETIME,
    CONSTRAINT "Record_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Record_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Record_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordId" TEXT NOT NULL,
    "actorId" TEXT,
    "field" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordRevision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecordRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "databaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Sprint',
    "goal" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "state" TEXT NOT NULL DEFAULT 'future',
    "releaseNotes" TEXT,
    "position" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sprint_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "View" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "databaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Vue',
    "type" TEXT NOT NULL DEFAULT 'table',
    "position" REAL NOT NULL DEFAULT 0,
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "View_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'app',
    "uploadMaxMb" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_idx" ON "Membership"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_workspaceId_key" ON "Membership"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "Template_workspaceId_idx" ON "Template"("workspaceId");

-- CreateIndex
CREATE INDEX "Section_workspaceId_idx" ON "Section"("workspaceId");

-- CreateIndex
CREATE INDEX "Page_parentId_idx" ON "Page"("parentId");

-- CreateIndex
CREATE INDEX "Page_workspaceId_position_idx" ON "Page"("workspaceId", "position");

-- CreateIndex
CREATE INDEX "Page_sectionId_idx" ON "Page"("sectionId");

-- CreateIndex
CREATE INDEX "Page_ownerId_idx" ON "Page"("ownerId");

-- CreateIndex
CREATE INDEX "Page_visibility_idx" ON "Page"("visibility");

-- CreateIndex
CREATE INDEX "Page_trashedAt_idx" ON "Page"("trashedAt");

-- CreateIndex
CREATE INDEX "PageVisit_userId_idx" ON "PageVisit"("userId");

-- CreateIndex
CREATE INDEX "PageVisit_pageId_idx" ON "PageVisit"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PageVisit_userId_pageId_key" ON "PageVisit"("userId", "pageId");

-- CreateIndex
CREATE UNIQUE INDEX "Database_pageId_key" ON "Database"("pageId");

-- CreateIndex
CREATE INDEX "DatabaseProperty_databaseId_position_idx" ON "DatabaseProperty"("databaseId", "position");

-- CreateIndex
CREATE INDEX "Record_databaseId_position_idx" ON "Record"("databaseId", "position");

-- CreateIndex
CREATE INDEX "Record_createdBy_idx" ON "Record"("createdBy");

-- CreateIndex
CREATE INDEX "Record_sprintId_idx" ON "Record"("sprintId");

-- CreateIndex
CREATE INDEX "Record_trashedAt_idx" ON "Record"("trashedAt");

-- CreateIndex
CREATE INDEX "RecordRevision_recordId_createdAt_idx" ON "RecordRevision"("recordId", "createdAt");

-- CreateIndex
CREATE INDEX "RecordRevision_recordId_field_idx" ON "RecordRevision"("recordId", "field");

-- CreateIndex
CREATE INDEX "Sprint_databaseId_position_idx" ON "Sprint"("databaseId", "position");

-- CreateIndex
CREATE INDEX "View_databaseId_position_idx" ON "View"("databaseId", "position");

