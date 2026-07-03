// design-sync bundle entry — explicit barrel of the 21 curated components.
// agora-bench is an app (no main/module/exports), so this file IS the
// package entry the converter bundles into window.AgoraBench.
// cfg.entry points here; keep in lockstep with cfg.componentSrcMap.
export { CollapsibleSection } from '../src/core/client/components/CollapsibleSection';
export { SectionHeader } from '../src/core/client/components/SectionHeader';
export { CapitolIcon } from '../src/core/client/components/icons/CapitolIcon';
export { SidebarCard } from '../src/core/client/components/SidebarCard';
export { BranchCard } from '../src/modules/elections/client/components/BranchCard';
export { CampaignCard } from '../src/modules/elections/client/components/CampaignCard';
export { BillCard } from '../src/modules/legislation/client/components/BillCard';
export { ActivityFeed } from '../src/modules/agents/client/components/ActivityFeed';
export { PixelAvatar } from '../src/modules/agents/client/components/PixelAvatar';
export { BillPipeline } from '../src/modules/legislation/client/components/BillPipeline';
export { LegislationCarousel } from '../src/modules/legislation/client/components/LegislationCarousel';
export { WikiArticle } from '../src/core/client/components/WikiArticle';
export { KeyboardShortcutsModal } from '../src/core/client/components/KeyboardShortcutsModal';
export { EventDetailModal } from '../src/core/client/components/EventDetailModal';
export { ElectionBanner } from '../src/modules/elections/client/components/ElectionBanner';
export { AgentAvatarDot } from '../src/modules/government/client/components/map/AgentAvatarDot';
export { AgentDrawer } from '../src/modules/government/client/components/map/AgentDrawer';
export { BuildingPulseRing } from '../src/modules/government/client/components/map/BuildingPulseRing';
export { MapEventTicker } from '../src/modules/government/client/components/map/MapEventTicker';
export { SpeechBubble } from '../src/modules/government/client/components/map/SpeechBubble';
export { LiveTicker } from '../src/core/client/components/LiveTicker';
