// Scout — main entry point
// Import order mirrors the original script-tag order in index.html.
// All files keep their window.* assignments; this just wires up the module graph.

import './shared/dev-preview-config.js';
import './shared/data-cache.js';
import './shared/app-config.js';
import './shared/bug-capture.js';
import './shared/constants.js';
import './shared/utils.js';
import './shared/storage.js';
import './shared/event-bus.js';
import './shared/supabase-client.js';
import './shared/tier.js';
import './shared/pick-value-model.js';
import './shared/dhq-providers.js';
import './shared/rookie-data.js';
import './shared/dhq-core.js';
import './shared/intelligence-context.js';
import './shared/dhq-engine.js';
import './shared/nfl-fit.js';
import './shared/team-assess.js';
import './shared/trade-engine.js';
import './shared/mock-engine.js';
import './shared/strategy.js';
import './shared/season-calendar.js';
import './shared/roster-snapshot.js';
import './shared/gm-engine.js';
import './shared/analytics-engine.js';
import './shared/dhq-ai.js';
import './shared/assistant-tutorial.js';
import './shared/league-memory.js';
import './shared/ai-dispatch.js';
import './shared/platform-provider.js';
import './shared/sleeper-api.js';
import './shared/espn-api.js';
import './shared/mfl-api.js';
import './shared/yahoo-api.js';

// WS0: browser engines promoted from War Room into dhq-shared (start/sit, weekly proj,
// NFL context, matchup, ROS value, draft gameplan, Alex voice, GM mode). Order matters:
// startsit before weekly-proj/matchup/player-value; player-value after dhq-engine (guarded globals).
import './shared/startsit-engine.js';
import './shared/weekly-proj.js';
import './shared/nfl-context.js';
import './shared/matchup.js';
import './shared/player-value.js';
import './shared/draft-gameplan.js';
import './shared/alex-voice.js';
import './shared/gm-mode.js';

import './js/app.js';
import './js/sleeper-api.js';
import './js/ai-chat.js';
import './js/ui.js';
import './js/player-modal.js';
import './js/shell.js';
import './js/draft-ui.js';
import './js/trade-calc.js';
import './js/trade-builder.js';
import './js/scout-ui.js';
import './js/calendar-scout.js';
import './js/history-scout.js';
import './js/analytics-scout.js';
import './js/tagged-sets.js';
import './js/compare-scout.js';
import './js/today-cards.js';
import './js/pro-launch.js';
import './js/tutorial.js';

// Rookie/prospect CSVs are vendored into public/draft-war-room/ and served
// same-origin (Vite base = /ReconAI/), so Scout no longer fetches rookie data
// cross-repo from WarRoom@main via jsDelivr. Point the shared rookie-data loader
// at our own deploy explicitly (page-independent); rookie-data.js's default is
// also same-origin-relative. Runs after imports but before any on-demand fetch.
window.ROOKIE_DATA_BASE = `${window.location.origin}${import.meta.env.BASE_URL}draft-war-room`;
