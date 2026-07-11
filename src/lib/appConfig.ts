import { prisma } from "./prisma";

const APP_CONFIG_ID = "app";

/** Réglages globaux de l'instance (ligne singleton, créée à la volée avec les défauts). */
export async function getAppConfig() {
  return prisma.appConfig.upsert({
    where: { id: APP_CONFIG_ID },
    update: {},
    create: { id: APP_CONFIG_ID },
  });
}

export async function setAppConfig(data: { uploadMaxMb?: number }) {
  return prisma.appConfig.upsert({
    where: { id: APP_CONFIG_ID },
    update: data,
    create: { id: APP_CONFIG_ID, ...data },
  });
}
