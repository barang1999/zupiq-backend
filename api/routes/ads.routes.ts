import { Router } from "express";
import { env } from "../../config/env.js";

const router = Router();

// Public endpoint — no auth required. Mobile app fetches this on launch and
// caches for 5 minutes. All fields default to the most restrictive safe value
// (adsEnabled: false, killSwitch: true) so a misconfigured backend never
// accidentally enables ads on the client.
router.get("/", (_req, res) => {
  res.json({
    version: `${new Date().toISOString().slice(0, 10)}.1`,
    adsEnabled: env.ADS_ENABLED,
    iosInterstitialEnabled: env.ADS_IOS_INTERSTITIAL_ENABLED,
    minCompletedGenerationsBeforeFirstAd: env.ADS_MIN_GENERATIONS_BEFORE_FIRST,
    minMinutesSinceInstall: env.ADS_MIN_MINUTES_SINCE_INSTALL,
    minSecondsBetweenAds: env.ADS_MIN_SECONDS_BETWEEN_ADS,
    minMeaningfulUserActionsBetweenAds: env.ADS_MIN_ACTIONS_BETWEEN_ADS,
    maxInterstitialsPerSession: env.ADS_MAX_PER_SESSION,
    maxInterstitialsPerLocalDay: env.ADS_MAX_PER_LOCAL_DAY,
    sponsoredScreenEnabled: true,
    sponsoredScreenMinimumMs: 250,
    sponsoredScreenMaximumMs: 600,
    rolloutPercent: env.ADS_ROLLOUT_PERCENT,
    killSwitch: env.ADS_KILL_SWITCH,
    eligiblePlacements: ["before_next_generation"],
  });
});

export default router;
