// Runtime component registry for scene visuals. Loaded by the Scene component
// at render time. NOT safe to import from Node scripts (pulls in React +
// Remotion). For Node-side validation use ./scene-visual-types instead.

import type React from 'react';
import { MobileMoneyVisual } from '../components/short/visuals/MobileMoneyVisual';
import { FakeBrokerVisual } from '../components/short/visuals/FakeBrokerVisual';
import { ListingScamVisual } from '../components/short/visuals/ListingScamVisual';
import { ListingAddressVisual } from '../components/short/visuals/ListingAddressVisual';
import { WaterTapVisual } from '../components/short/visuals/WaterTapVisual';
import { ShowerVisual } from '../components/short/visuals/ShowerVisual';
import { MeterVisual } from '../components/short/visuals/MeterVisual';
import { LeakAlertVisual } from '../components/short/visuals/LeakAlertVisual';
import { ScheduleClockVisual } from '../components/short/visuals/ScheduleClockVisual';
import { BuildingVisual } from '../components/short/visuals/BuildingVisual';
import { NightDaySplitVisual } from '../components/short/visuals/NightDaySplitVisual';
import { CorridorLightVisual } from '../components/short/visuals/CorridorLightVisual';
import { NoiseListenVisual } from '../components/short/visuals/NoiseListenVisual';
import { TrafficVisual } from '../components/short/visuals/TrafficVisual';
import { TransitIconsVisual } from '../components/short/visuals/TransitIconsVisual';
import { BudgetCalcVisual } from '../components/short/visuals/BudgetCalcVisual';
import { IdCheckVisual } from '../components/short/visuals/IdCheckVisual';
import { DocumentStackVisual } from '../components/short/visuals/DocumentStackVisual';
import { VerbalHandshakeVisual } from '../components/short/visuals/VerbalHandshakeVisual';
import { ContractVisual } from '../components/short/visuals/ContractVisual';
import { FinePrintVisual } from '../components/short/visuals/FinePrintVisual';
import { CalendarNoticeVisual } from '../components/short/visuals/CalendarNoticeVisual';
import { ExpensesBreakdownVisual } from '../components/short/visuals/ExpensesBreakdownVisual';
import { ReceiptVisual } from '../components/short/visuals/ReceiptVisual';
import type { SceneVisualType } from './scene-visual-types';

export type SceneVisualProps = {
  variant?: string;
  durationInFrames: number;
};

export type SceneVisualComponent = React.FC<SceneVisualProps>;

export const SCENE_VISUALS: Record<SceneVisualType, SceneVisualComponent> = {
  'mobile-money': MobileMoneyVisual,
  'fake-broker': FakeBrokerVisual,
  'listing-scam': ListingScamVisual,
  'listing-address': ListingAddressVisual,
  'water-tap': WaterTapVisual,
  'shower': ShowerVisual,
  'meter': MeterVisual,
  'leak-alert': LeakAlertVisual,
  'schedule-clock': ScheduleClockVisual,
  'building': BuildingVisual,
  'night-day-split': NightDaySplitVisual,
  'corridor-light': CorridorLightVisual,
  'noise-listen': NoiseListenVisual,
  'traffic': TrafficVisual,
  'transit-icons': TransitIconsVisual,
  'budget-calc': BudgetCalcVisual,
  'id-check': IdCheckVisual,
  'document-stack': DocumentStackVisual,
  'verbal-handshake': VerbalHandshakeVisual,
  'contract': ContractVisual,
  'fine-print': FinePrintVisual,
  'calendar-notice': CalendarNoticeVisual,
  'expenses-breakdown': ExpensesBreakdownVisual,
  'receipt': ReceiptVisual,
};

export { SCENE_VISUAL_TYPES, isSceneVisualType } from './scene-visual-types';
export type { SceneVisualType } from './scene-visual-types';
