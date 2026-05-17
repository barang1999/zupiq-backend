import { getSupabaseAdmin } from "../config/supabase.js";
import dotenv from "dotenv";

dotenv.config();

const MATH_ID = "017d3f2f-f212-4cf1-b522-c176b7027acf";
const PHYSICS_ID = "cc02b7ca-a34b-4010-b7e4-bffb9be2a3cb";
const CHEMISTRY_ID = "98dca07b-2f9f-4e8b-83a0-428863d1e527";

const SUBJECTS_TO_SEED = [
  { id: MATH_ID, name: "Math", slug: "mathematics", description: "Mathematics, Algebra, Geometry, Calculus" },
  { id: PHYSICS_ID, name: "Physics", slug: "physics", description: "Mechanics, Electromagnetism, Thermodynamics, Optics" },
  { id: CHEMISTRY_ID, name: "Chemistry", slug: "chemistry", description: "Organic, Inorganic, Physical, Biochemistry" },
];

const TOPICS_TO_SEED = [
  // Math
  { id: "topic-math-algebra", subject_id: MATH_ID, name: "Algebra", slug: "algebra", description: "Equations, Polynomials, Sequences, Series", order_index: 1 },
  { id: "topic-math-geometry", subject_id: MATH_ID, name: "Geometry", slug: "geometry", description: "Coordinate Geometry, Vectors, Trigonometry", order_index: 2 },
  { id: "topic-math-calculus", subject_id: MATH_ID, name: "Calculus & Analysis", slug: "calculus", description: "Limits, Integrals, Derivatives, Functions", order_index: 3 },
  { id: "topic-math-probability-stats", subject_id: MATH_ID, name: "Probability & Statistics", slug: "probability-stats", description: "Permutations, Combinations, Probability distributions", order_index: 4 },
  { id: "topic-math-arithmetic", subject_id: MATH_ID, name: "Arithmetic & Numbers", slug: "arithmetic", description: "Fractions, Radicals, Number Theory", order_index: 5 },

  // Physics
  { id: "topic-physics-mechanics", subject_id: PHYSICS_ID, name: "Mechanics", slug: "mechanics", description: "Forces, Motion, Newton's Laws, Energy", order_index: 1 },
  { id: "topic-physics-electromagnetism", subject_id: PHYSICS_ID, name: "Electromagnetism", slug: "electromagnetism", description: "Circuits, Electric Fields, Magnetic Induction", order_index: 2 },
  { id: "topic-physics-thermodynamics", subject_id: PHYSICS_ID, name: "Thermodynamics", slug: "thermodynamics", description: "Heat, Gas Laws, Entropy, Phase Changes", order_index: 3 },
  { id: "topic-physics-optics-waves", subject_id: PHYSICS_ID, name: "Optics & Waves", slug: "optics-waves", description: "Light, Lenses, Reflection, Sound Waves", order_index: 4 },
  { id: "topic-physics-modern-physics", subject_id: PHYSICS_ID, name: "Modern & Nuclear Physics", slug: "modern-physics", description: "Relativity, Quantum, Radioactive Decay", order_index: 5 },

  // Chemistry
  { id: "topic-chemistry-general-chemistry", subject_id: CHEMISTRY_ID, name: "General Chemistry", slug: "general-chemistry", description: "Periodic Table, Stoichiometry, Gases, Bonding", order_index: 1 },
  { id: "topic-chemistry-organic-chemistry", subject_id: CHEMISTRY_ID, name: "Organic Chemistry", slug: "organic-chemistry", description: "Alkanes, Functional Groups, Polymerization", order_index: 2 },
  { id: "topic-chemistry-inorganic-chemistry", subject_id: CHEMISTRY_ID, name: "Inorganic Chemistry", slug: "inorganic-chemistry", description: "Transition Metals, Coordination Compounds", order_index: 3 },
  { id: "topic-chemistry-physical-chemistry", subject_id: CHEMISTRY_ID, name: "Physical Chemistry", slug: "physical-chemistry", description: "Kinetics, Equilibrium, Acid-Base, Electrochemistry", order_index: 4 },
  { id: "topic-chemistry-biochemistry", subject_id: CHEMISTRY_ID, name: "Biochemistry", slug: "biochemistry", description: "Proteines, DNA/RNA, Enzymes, Metabolic Pathways", order_index: 5 },
];

async function main() {
  const db = getSupabaseAdmin();
  console.log("Starting Subject & Sub-Subject Taxonomy Seeding...\n");

  // 1. Seed Subjects
  console.log("Seeding canonical subjects...");
  for (const subject of SUBJECTS_TO_SEED) {
    const { error } = await db.from("subjects").upsert(subject, { onConflict: "id" });
    if (error) {
      console.error(`Failed to upsert subject ${subject.name}:`, error.message);
      return;
    }
    console.log(`- Upserted subject: ${subject.name}`);
  }
  console.log("Canonical subjects seeding complete.\n");

  // 2. Seed Topics
  console.log("Seeding predefined sub-subjects (topics)...");
  for (const topic of TOPICS_TO_SEED) {
    const { error } = await db.from("topics").upsert(topic, { onConflict: "id" });
    if (error) {
      console.error(`Failed to upsert topic ${topic.name}:`, error.message);
      return;
    }
    console.log(`- Upserted topic: ${topic.name} under subject ID: ${topic.subject_id}`);
  }
  console.log("Sub-subjects seeding complete.\n");

  // 3. Backfill Existing Study Sessions
  console.log("Fetching existing study sessions for backfill...");
  const { data: sessions, error: sessionsError } = await db.from("study_sessions").select("*");
  if (sessionsError) {
    console.error("Failed to fetch sessions for backfill:", sessionsError.message);
    return;
  }

  console.log(`Found ${sessions?.length ?? 0} study sessions. Backfilling...`);
  let backfillSuccess = true;

  for (const session of sessions ?? []) {
    let targetSubjectId = session.subject_id;
    let targetSubjectName = session.subject;
    let targetTopicSlug = null;
    let targetTopicId = null;

    // A. Detect main subject re-mappings
    const oldSubjectName = String(session.subject || "").trim().toLowerCase();
    const oldSubjectId = session.subject_id;

    // Check if session links to a deprecated/deleted subject
    const isDeprecatedSubject = ![MATH_ID, PHYSICS_ID, CHEMISTRY_ID].includes(oldSubjectId);

    if (
      isDeprecatedSubject ||
      oldSubjectName.includes("math") ||
      oldSubjectName.includes("គណិត") ||
      oldSubjectName.includes("ស្វ៊ីត") ||
      oldSubjectName.includes("algebra") ||
      oldSubjectName.includes("calculus") ||
      oldSubjectName.includes("ពិជគណិត")
    ) {
      targetSubjectId = MATH_ID;
      targetSubjectName = "Math";
    } else if (oldSubjectName.includes("physic") || oldSubjectName.includes("រូបវិទ្យា")) {
      targetSubjectId = PHYSICS_ID;
      targetSubjectName = "Physics";
    } else if (oldSubjectName.includes("chem") || oldSubjectName.includes("គីមី")) {
      targetSubjectId = CHEMISTRY_ID;
      targetSubjectName = "Chemistry";
    }

    // B. Detect sub-subject (topic) classifications
    // Inspect both old subject names and breakdown content
    const fullTextSearch = `${session.subject} ${session.title} ${session.problem}`.toLowerCase();
    
    if (targetSubjectId === MATH_ID) {
      if (fullTextSearch.includes("ស្វ៊ីត") || fullTextSearch.includes("ស៊េរី") || fullTextSearch.includes("sequence") || fullTextSearch.includes("series") || fullTextSearch.includes("algebra") || fullTextSearch.includes("ពិជគណិត") || fullTextSearch.includes("លីនេអ៊ែរ")) {
        targetTopicSlug = "algebra";
        targetTopicId = "topic-math-algebra";
      } else if (fullTextSearch.includes("ធរណីមាត្រ") || fullTextSearch.includes("geometry") || fullTextSearch.includes("ត្រីកោណមាត្រ") || fullTextSearch.includes("vector")) {
        targetTopicSlug = "geometry";
        targetTopicId = "topic-math-geometry";
      } else if (fullTextSearch.includes("calculus") || fullTextSearch.includes("លីមីត") || fullTextSearch.includes("ដេរីវេ") || fullTextSearch.includes("អាំងតេក្រាល") || fullTextSearch.includes("limit") || fullTextSearch.includes("integral") || fullTextSearch.includes("derivative")) {
        targetTopicSlug = "calculus";
        targetTopicId = "topic-math-calculus";
      } else if (fullTextSearch.includes("ប្រូបាប") || fullTextSearch.includes("probability") || fullTextSearch.includes("ស្ថិតិ") || fullTextSearch.includes("statistics") || fullTextSearch.includes("mean")) {
        targetTopicSlug = "probability-stats";
        targetTopicId = "topic-math-probability-stats";
      } else {
        targetTopicSlug = "arithmetic";
        targetTopicId = "topic-math-arithmetic";
      }
    } else if (targetSubjectId === PHYSICS_ID) {
      if (fullTextSearch.includes("កម្លាំង") || fullTextSearch.includes("ចលនា") || fullTextSearch.includes("force") || fullTextSearch.includes("motion") || fullTextSearch.includes("energy")) {
        targetTopicSlug = "mechanics";
        targetTopicId = "topic-physics-mechanics";
      } else if (fullTextSearch.includes("អគ្គិសនី") || fullTextSearch.includes("circuits") || fullTextSearch.includes("magnetic")) {
        targetTopicSlug = "electromagnetism";
        targetTopicId = "topic-physics-electromagnetism";
      } else if (fullTextSearch.includes("កម្ដៅ") || fullTextSearch.includes("heat") || fullTextSearch.includes("thermo")) {
        targetTopicSlug = "thermodynamics";
        targetTopicId = "topic-physics-thermodynamics";
      } else if (fullTextSearch.includes("រលក") || fullTextSearch.includes("waves") || fullTextSearch.includes("light") || fullTextSearch.includes("optics")) {
        targetTopicSlug = "optics-waves";
        targetTopicId = "topic-physics-optics-waves";
      } else {
        targetTopicSlug = "modern-physics";
        targetTopicId = "topic-physics-modern-physics";
      }
    } else if (targetSubjectId === CHEMISTRY_ID) {
      if (fullTextSearch.includes("សរីរាង្គ") || fullTextSearch.includes("alkane") || fullTextSearch.includes("organic")) {
        targetTopicSlug = "organic-chemistry";
        targetTopicId = "topic-chemistry-organic-chemistry";
      } else if (fullTextSearch.includes("ជីវគីមី") || fullTextSearch.includes("dna") || fullTextSearch.includes("protein")) {
        targetTopicSlug = "biochemistry";
        targetTopicId = "topic-chemistry-biochemistry";
      } else {
        targetTopicSlug = "general-chemistry";
        targetTopicId = "topic-chemistry-general-chemistry";
      }
    }

    // C. Perform session update
    const updatePayload: Record<string, any> = {
      subject: targetSubjectName,
      subject_id: targetSubjectId,
      topic: targetTopicSlug,
      topic_id: targetTopicId,
    };

    const { error: updateError } = await db
      .from("study_sessions")
      .update(updatePayload)
      .eq("id", session.id);

    if (updateError) {
      if (updateError.message.includes("column \"topic\" of relation \"study_sessions\" does not exist")) {
        console.warn("\n[WARNING]: 'topic' or 'topic_id' columns do not exist in the Supabase 'study_sessions' table yet.");
        console.warn("Please copy and run the SQL contents of database/migrations/seed_subject_taxonomy.sql in your Supabase SQL Editor first!");
        backfillSuccess = false;
        break;
      } else {
        console.error(`Failed to backfill session ${session.id}:`, updateError.message);
      }
    } else {
      console.log(`- Backfilled session ${session.id}: subject=${targetSubjectName}, topic=${targetTopicSlug}`);
    }
  }

  if (backfillSuccess) {
    console.log("\nExisting study sessions successfully backfilled!");
    
    // 4. Clean up Legacy/Fragmented Subjects
    console.log("\nCleaning up legacy deprecated subjects from the 'subjects' table...");
    const { error: deleteError } = await db
      .from("subjects")
      .delete()
      .not("id", "in", `(${[MATH_ID, PHYSICS_ID, CHEMISTRY_ID].join(",")})`);

    if (deleteError) {
      console.error("Failed to delete deprecated subjects:", deleteError.message);
    } else {
      console.log("Legacy fragmented subjects successfully removed from the database.");
    }
  }

  console.log("\nTaxonomy Seeding & Migration Completed Successfully.");
}

main().catch(console.error);
