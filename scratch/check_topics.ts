import { getSupabaseAdmin } from "../config/supabase.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("topics").select("*");
  if (error) {
    console.error("Error fetching topics:", error);
    return;
  }
  console.log("Existing Topics:");
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
