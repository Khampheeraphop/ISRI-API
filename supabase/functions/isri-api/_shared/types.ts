import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type AppRole = "reporter" | "technician" | "dispatcher" | "admin";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type Specialty =
  | "electrical"
  | "plumbing"
  | "air_conditioning"
  | "elevator"
  | "building";
export type DatabaseClient = SupabaseClient;

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  approval_status: ApprovalStatus;
  role: AppRole | null;
  requested_position: string | null;
  technician_specialties: Specialty[];
}

export const profileColumns =
  "id, email, full_name, approval_status, role, requested_position, technician_specialties";
export const allowedSpecialties = new Set<Specialty>([
  "electrical",
  "plumbing",
  "air_conditioning",
  "elevator",
  "building",
]);
export const allowedRoles = new Set<AppRole>([
  "reporter",
  "technician",
  "dispatcher",
  "admin",
]);
export const allowedCategories = new Set([
  "ไฟฟ้า",
  "ประปา",
  "เครื่องปรับอากาศ",
  "ลิฟต์",
  "โครงสร้าง/พื้นผิวอาคาร (ผนัง พื้น เพดาน ประตู)",
]);

export const isApproved = (profile: Profile) =>
  profile.approval_status === "approved" && profile.role !== null;
