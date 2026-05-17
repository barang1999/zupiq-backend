import { getSupabaseAdmin } from "../config/supabase.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("subjects").select("*");
  if (error) {
    console.error("Error fetching subjects:", error);
    return;
  }
  console.log("Existing Subjects:");
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
