// ============================================================================
// js/tutorial.js - Scout first-launch GM briefing config.
// Shared engine lives in shared/assistant-tutorial.js.
// ============================================================================

const SCOUT_TUTORIAL_CONFIG = {
  productKey: 'scout',
  version: 'gm-brief-v1',
  legacyKeys: ['scout_tutorial_done_v1'],
  accent: '#D4AF37',
  title: 'Welcome to the GM Room',
  kicker: 'Alex Ingram / Scout Briefing',
  intro: 'I am Alex Ingram, your GM chief of staff. Scout is the fast room: daily intel, roster pressure, player search, and the tools you use before a move hits the league chat.',
  openingChips: ['90-second brief', 'Scout command map', 'Replay in settings'],
  openingBoard: {
    label: 'Scout Assignment',
    title: 'Find the next move',
    body: 'I will show you where the daily signal lives, where to inspect your roster, and where to ask me to pressure-test a decision.',
  },
  steps: [
    {
      key: 'daily-brief',
      switchTab: 'digest',
      target: '#panel-digest',
      title: 'Daily Brief',
      desc: 'This is the morning board. Team health, leverage, roster gaps, and the next action items surface here so you do not have to hunt through the app first.',
      kicker: 'Intel Board',
      chips: ['team health', 'position gaps', 'next move'],
      board: {
        label: 'Alex Read',
        title: 'Start here',
        body: 'If something changed in your league, this is where I want your eyes first.',
      },
    },
    {
      key: 'ask-alex',
      target: '.global-chat-row',
      title: 'Ask Alex',
      desc: 'Search a player, ask a league question, or make me compare options. Keep the question plain-English; I will bring roster context, values, and owner behavior into the answer.',
      kicker: 'Decision Desk',
      chips: ['player search', 'league questions', 'move checks'],
      board: {
        label: 'Usage Note',
        title: 'Use it before you act',
        body: 'The best use is not generic advice. Ask me whether this specific roster should make this specific move.',
      },
    },
    {
      key: 'team-command',
      mobileTab: 'team',
      target: '#mnav-team',
      title: 'Team Command',
      desc: 'This is your roster room. Check player value, positional depth, draft bank, FAAB posture, and the pressure points that should shape your next move.',
      kicker: 'Roster Room',
      chips: ['roster rooms', 'FAAB', 'draft bank'],
      board: {
        label: 'GM Habit',
        title: 'Know the weak room',
        body: 'Before any trade or waiver claim, know which position room is forcing the decision.',
      },
    },
    {
      key: 'tool-workspaces',
      mobileTab: 'tools',
      target: '#mnav-tools',
      title: 'Tool Workspaces',
      desc: 'Tools is where the deep work happens: trades, waivers, mocks, rookie boards, start/sit, and league intel. This is where ideas become executable plans.',
      kicker: 'Work Table',
      chips: ['trades', 'waivers', 'draft prep'],
      board: {
        label: 'Workflow',
        title: 'Move from read to action',
        body: 'Use the brief for signal, then come here to build the actual move.',
      },
    },
    {
      key: 'portfolio',
      mobileTab: 'portfolio',
      target: '#mnav-portfolio',
      title: 'Portfolio',
      desc: 'Portfolio keeps multi-league priorities, league intel, activity, and your field log together. It is the front-office view when you are managing more than one room.',
      kicker: 'Ownership View',
      chips: ['multi-league', 'field log', 'activity'],
      board: {
        label: 'Operating Rule',
        title: 'Do not lose context',
        body: 'Good dynasty players remember the move. Good GMs remember why the move was made.',
      },
    },
    {
      key: 'settings',
      switchTab: 'settings',
      target: 'button[title="Settings"]',
      title: 'Settings And Alex',
      desc: 'Settings is where you manage subscription access, reconnect data, and replay this briefing. If the room feels off, start here.',
      kicker: 'Control Room',
      chips: ['account', 'data', 'replay'],
      board: {
        label: 'Replay',
        title: 'Run the brief anytime',
        body: 'A replay button lives with Alex settings so you can re-orient after updates.',
      },
    },
  ],
  finishTitle: 'Scout Is Ready',
  finishText: 'You have the room map. Start with the Daily Brief, inspect the pressure point, then ask me to stress-test the move before you send it.',
  finishChips: ['Brief first', 'Tools second', 'Ask before action'],
  finishBoard: {
    label: 'First Call',
    title: 'Open with leverage',
    body: 'Ask: What are the top three moves this roster should consider right now?',
  },
};

async function shouldShowTutorial() {
  if (window.App?.AssistantTutorial?.shouldShow) {
    return window.App.AssistantTutorial.shouldShow(SCOUT_TUTORIAL_CONFIG);
  }
  return !localStorage.getItem('scout_tutorial_done_v1');
}

function startTutorial(options) {
  if (!window.App?.AssistantTutorial?.start) return false;
  return window.App.AssistantTutorial.start(SCOUT_TUTORIAL_CONFIG, options || {});
}

function replayScoutTutorial() {
  return startTutorial({ force: true });
}

window.SCOUT_TUTORIAL_CONFIG = SCOUT_TUTORIAL_CONFIG;
window.startTutorial = startTutorial;
window.shouldShowTutorial = shouldShowTutorial;
window.replayScoutTutorial = replayScoutTutorial;
