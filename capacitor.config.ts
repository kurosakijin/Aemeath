import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.aemeath.mobile",
  appName: "Aemeath",
  webDir: "mobile-web",
  server: {
    url: process.env.AEMEATH_APP_URL || "https://aemeath.abiv0422.workers.dev/",
    androidScheme: "https",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#18191d",
  },
};

export default config;
