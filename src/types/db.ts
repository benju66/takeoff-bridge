import { ProcessedTakeoffRow } from "./index";

export interface Project {
  id: string;
  name: string;
  location: string;
  squareFootage: number;
  unitCount: number;
  bidDate: string;
  createdAt: string;
  buildingPerimeter?: number;
  buildingFootprint?: number;
  podiumArea?: number;
  woodframedArea?: number;
  levelsAbovePodium?: number;
  expectedStart?: string;
  expectedFinish?: string;
}

export interface ProjectEstimate {
  projectId: string;
  subtotal: number;
  generalLiability: number;
  fee: number;
  totalCost: number;
  items: ProcessedTakeoffRow[];
  generalConditionsTotal?: number;
  gcUtilization?: Record<string, number>;
  gcEquipmentOverrides?: Record<string, number>;
  siteOperationsTotal?: number;
  siteOpsQuantities?: Record<string, number>;
  siteOpsRates?: Record<string, number>;
}

