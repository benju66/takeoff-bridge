import { ProcessedTakeoffRow } from "./index";

export interface Project {
  id: string;
  name: string;
  location: string;
  squareFootage: number;
  unitCount: number;
  bidDate: string;
  createdAt: string;
}

export interface ProjectEstimate {
  projectId: string;
  subtotal: number;
  generalLiability: number;
  fee: number;
  totalCost: number;
  items: ProcessedTakeoffRow[];
}
