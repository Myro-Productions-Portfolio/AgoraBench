/**
 * Bespoke inline-SVG icon set for AgoraBench.
 *
 * One source of truth replacing the Unicode glyphs and emoji that were
 * scattered across the admin sidebar, global search, agent directory, the
 * Tools dropdown, the main nav and the activity feed.
 *
 * Conventions (match the original ActivityFeed drawings):
 *   - 16x16 viewBox, stroke-based, strokeWidth ~1.2
 *   - stroke="currentColor" so callers pick the color with a `text-*` class
 *   - `size` prop (default 16) drives width/height; `className` passes through
 *   - always aria-hidden (icons are decorative; labels carry the meaning)
 *
 * Semantic rule: the same drawing means the same concept everywhere. Justice
 * (scales) is never reused for legislation (document); government (columns) is
 * never reused for weights (sliders).
 */

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

type PathContent = React.ReactNode;

function makeIcon(name: string, content: PathContent) {
  function Icon({ size = 16, className, strokeWidth = 1.2 }: IconProps) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        width={size}
        height={size}
        className={className}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {content}
      </svg>
    );
  }
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

/* Home / dashboard — house outline */
export const HomeIcon = makeIcon('home', (
  <>
    <path d="M2 7L8 2L14 7" />
    <path d="M3.5 6.5V14H12.5V6.5" />
  </>
));

/* Capitol / government — columned building (also the logomark) */
export const CapitolIcon = makeIcon('capitol', (
  <>
    <path d="M8 1.5L14 5H2L8 1.5Z" />
    <path d="M3 5V12M6 5V12M10 5V12M13 5V12" />
    <path d="M2 12H14M1.5 14H14.5" />
  </>
));

/* Map — folded map with route */
export const MapIcon = makeIcon('map', (
  <>
    <path d="M2 4L6 2.5L10 4L14 2.5V12L10 13.5L6 12L2 13.5V4Z" />
    <path d="M6 2.5V12M10 4V13.5" />
  </>
));

/* Budget / treasury — currency column */
export const BudgetIcon = makeIcon('budget', (
  <>
    <path d="M8 2V14" />
    <path d="M11 4.5C11 3.4 9.7 2.8 8 2.8C6.3 2.8 5 3.5 5 4.7C5 7.5 11 6 11 9.2C11 10.5 9.7 11.2 8 11.2C6.3 11.2 5 10.6 5 9.5" />
  </>
));

/* Bill / document — page with lines */
export const DocumentIcon = makeIcon('document', (
  <>
    <path d="M4 1.5H10L13 4.5V14.5H4V1.5Z" />
    <path d="M9.5 1.5V5H13" />
    <path d="M6 8H11M6 10.5H11M6 12.5H9" />
  </>
));

/* Law / enacted — gavel */
export const GavelIcon = makeIcon('gavel', (
  <>
    <path d="M2.5 13.5H7.5" />
    <path d="M9.5 3.5L12.5 6.5" />
    <path d="M8 2L11 5L6.5 9.5L3.5 6.5L8 2Z" />
    <path d="M6.5 8L4.5 11.5" />
  </>
));

/* Court / justice — balance scales */
export const ScalesIcon = makeIcon('scales', (
  <>
    <path d="M8 2V13" />
    <path d="M4 13H12" />
    <path d="M3 4.5H13" />
    <path d="M3 4.5L1.5 8H4.5L3 4.5Z" />
    <path d="M13 4.5L11.5 8H14.5L13 4.5Z" />
  </>
));

/* Election / ballot — box with slot and check */
export const BallotIcon = makeIcon('ballot', (
  <>
    <path d="M2.5 6H13.5V14H2.5V6Z" />
    <path d="M6 6V4L10 4V6" />
    <path d="M5.5 9.5L7 11L10.5 7.5" />
  </>
));

/* Party — flag on a pole */
export const FlagIcon = makeIcon('flag', (
  <>
    <path d="M4 1.5V14.5" />
    <path d="M4 2.5H12L10 5L12 7.5H4" />
  </>
));

/* Forum — speech bubble */
export const ForumIcon = makeIcon('forum', (
  <>
    <path d="M2 3.5H14V11H8L5 13.5V11H2V3.5Z" />
    <path d="M5 6.5H11M5 8.5H9" />
  </>
));

/* Press — newspaper */
export const NewspaperIcon = makeIcon('newspaper', (
  <>
    <path d="M2 3H12V13H2V3Z" />
    <path d="M12 5.5H14V12C14 12.6 13.6 13 13 13H12" />
    <path d="M4 5.5H10M4 8H7M4 10.5H7M8.5 8H10V10.5H8.5V8Z" />
  </>
));

/* Activity — pulse line */
export const PulseIcon = makeIcon('pulse', (
  <path d="M1.5 8H4L6 3L9.5 13L11.5 8H14.5" />
));

/* Calendar */
export const CalendarIcon = makeIcon('calendar', (
  <>
    <path d="M2.5 3.5H13.5V13.5H2.5V3.5Z" />
    <path d="M2.5 6.5H13.5" />
    <path d="M5.5 2V5M10.5 2V5" />
  </>
));

/* Agents / users — two figures */
export const UsersIcon = makeIcon('users', (
  <>
    <circle cx="6" cy="5" r="2.2" />
    <path d="M1.5 13.5C1.5 10.7 3.5 9 6 9C8.5 9 10.5 10.7 10.5 13.5" />
    <path d="M10.5 3.2C11.7 3.4 12.5 4.4 12.5 5.5C12.5 6.6 11.7 7.6 10.5 7.8" />
    <path d="M11 9.2C13 9.7 14.5 11.3 14.5 13.5" />
  </>
));

/* Single profile / user */
export const UserIcon = makeIcon('user', (
  <>
    <circle cx="8" cy="5" r="2.6" />
    <path d="M2.5 13.5C2.5 10.5 5 8.5 8 8.5C11 8.5 13.5 10.5 13.5 13.5" />
  </>
));

/* Settings / gear */
export const SettingsIcon = makeIcon('settings', (
  <>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5V3M8 13V14.5M1.5 8H3M13 8H14.5M3.3 3.3L4.4 4.4M11.6 11.6L12.7 12.7M12.7 3.3L11.6 4.4M4.4 11.6L3.3 12.7" />
  </>
));

/* Research / flask */
export const FlaskIcon = makeIcon('flask', (
  <>
    <path d="M6.5 1.5V6L3 12.5C2.7 13 3 13.5 3.6 13.5H12.4C13 13.5 13.3 13 13 12.5L9.5 6V1.5" />
    <path d="M5.5 1.5H10.5" />
    <path d="M4.5 10H11.5" />
  </>
));

/* Warning / alert — triangle with bang */
export const WarningIcon = makeIcon('warning', (
  <>
    <path d="M8 2L14.5 13.5H1.5L8 2Z" />
    <path d="M8 6.5V9.5M8 11.5V11.6" />
  </>
));

/* Weights / sliders */
export const SlidersIcon = makeIcon('sliders', (
  <>
    <path d="M2 4.5H14M2 8H14M2 11.5H14" />
    <circle cx="5" cy="4.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="8" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
  </>
));

/* Star — leader / president */
export const StarIcon = makeIcon('star', (
  <path d="M8 1.5L9.9 5.6L14.5 6.2L11.2 9.4L12 14L8 11.7L4 14L4.8 9.4L1.5 6.2L6.1 5.6L8 1.5Z" />
));

/* Overview — grid of squares */
export const GridIcon = makeIcon('grid', (
  <>
    <path d="M2.5 2.5H7V7H2.5V2.5Z" />
    <path d="M9 2.5H13.5V7H9V2.5Z" />
    <path d="M2.5 9H7V13.5H2.5V9Z" />
    <path d="M9 9H13.5V13.5H9V9Z" />
  </>
));

/* Providers — server / plug stack */
export const ServerIcon = makeIcon('server', (
  <>
    <path d="M2.5 2.5H13.5V7H2.5V2.5Z" />
    <path d="M2.5 9H13.5V13.5H2.5V9Z" />
    <path d="M4.5 4.75V4.76M4.5 11.25V11.26" />
  </>
));

/* Access — key */
export const KeyIcon = makeIcon('key', (
  <>
    <circle cx="5" cy="5" r="3" />
    <path d="M7 7L13.5 13.5" />
    <path d="M11 11L12.5 9.5M9.5 9.5L11 8" />
  </>
));

/* Database — cylinder */
export const DatabaseIcon = makeIcon('database', (
  <>
    <path d="M8 4.5C10.8 4.5 13 3.7 13 2.75C13 1.8 10.8 1 8 1C5.2 1 3 1.8 3 2.75C3 3.7 5.2 4.5 8 4.5Z" />
    <path d="M3 2.75V8C3 8.95 5.2 9.75 8 9.75C10.8 9.75 13 8.95 13 8V2.75" />
    <path d="M3 8V13.25C3 14.2 5.2 15 8 15C10.8 15 13 14.2 13 13.25V8" />
  </>
));

/* Experiments — beaker with bubbles */
export const BeakerIcon = makeIcon('beaker', (
  <>
    <path d="M5.5 1.5H10.5" />
    <path d="M6.5 1.5V7L3.5 12.5C3.2 13 3.5 13.5 4.1 13.5H11.9C12.5 13.5 12.8 13 12.5 12.5L9.5 7V1.5" />
    <path d="M7.5 9.5V9.51M9 11V11.01" />
  </>
));

/* Health — heart with a beat */
export const HeartIcon = makeIcon('heart', (
  <path d="M8 13.5C8 13.5 2 10 2 5.8C2 3.9 3.4 2.5 5.2 2.5C6.4 2.5 7.4 3.2 8 4.2C8.6 3.2 9.6 2.5 10.8 2.5C12.6 2.5 14 3.9 14 5.8C14 10 8 13.5 8 13.5Z" />
));

/* Cabinet secretary — briefcase */
export const BriefcaseIcon = makeIcon('briefcase', (
  <>
    <path d="M2.5 5.5H13.5V13H2.5V5.5Z" />
    <path d="M6 5.5V3.5H10V5.5" />
    <path d="M2.5 9H13.5" />
  </>
));

/* Campaign — megaphone */
export const MegaphoneIcon = makeIcon('megaphone', (
  <>
    <path d="M2 6.5L10.5 3V12.5L2 9V6.5Z" />
    <path d="M2 6.5H1V9H2" />
    <path d="M4 9.5V12.5L6 13V10.2" />
    <path d="M12.5 6.5C13.3 6.5 13.8 7.1 13.8 7.75C13.8 8.4 13.3 9 12.5 9" />
  </>
));
