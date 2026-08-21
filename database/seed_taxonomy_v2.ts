import { getSupabaseAdmin } from "../config/supabase.js";
import { generateId } from "../utils/helpers.js";
import dotenv from "dotenv";

dotenv.config();

const TOPICS_TO_SEED = [
  // Math
  { id: "topic-math-algebra", slugKey: "mathematics", name: "Algebra", slug: "algebra", description: "Equations, Polynomials, Sequences, Series", order_index: 1 },
  { id: "topic-math-geometry", slugKey: "mathematics", name: "Geometry", slug: "geometry", description: "Coordinate Geometry, Vectors, Trigonometry", order_index: 2 },
  { id: "topic-math-calculus", slugKey: "mathematics", name: "Calculus & Analysis", slug: "calculus", description: "Limits, Integrals, Derivatives, Functions", order_index: 3 },
  { id: "topic-math-probability-stats", slugKey: "mathematics", name: "Probability & Statistics", slug: "probability-stats", description: "Permutations, Combinations, Probability distributions", order_index: 4 },
  { id: "topic-math-arithmetic", slugKey: "mathematics", name: "Arithmetic & Numbers", slug: "arithmetic", description: "Fractions, Radicals, Number Theory", order_index: 5 },

  // Physics
  { id: "topic-physics-mechanics", slugKey: "physics", name: "Mechanics", slug: "mechanics", description: "Forces, Motion, Newton's Laws, Energy", order_index: 1 },
  { id: "topic-physics-electromagnetism", slugKey: "physics", name: "Electromagnetism", slug: "electromagnetism", description: "Circuits, Electric Fields, Magnetic Induction", order_index: 2 },
  { id: "topic-physics-thermodynamics", slugKey: "physics", name: "Thermodynamics", slug: "thermodynamics", description: "Heat, Gas Laws, Entropy, Phase Changes", order_index: 3 },
  { id: "topic-physics-optics-waves", slugKey: "physics", name: "Optics & Waves", slug: "optics-waves", description: "Light, Lenses, Reflection, Sound Waves", order_index: 4 },
  { id: "topic-physics-modern-physics", slugKey: "physics", name: "Modern & Nuclear Physics", slug: "modern-physics", description: "Relativity, Quantum, Radioactive Decay", order_index: 5 },

  // Chemistry
  { id: "topic-chemistry-general-chemistry", slugKey: "chemistry", name: "General Chemistry", slug: "general-chemistry", description: "Periodic Table, Stoichiometry, Gases, Bonding", order_index: 1 },
  { id: "topic-chemistry-organic-chemistry", slugKey: "chemistry", name: "Organic Chemistry", slug: "organic-chemistry", description: "Alkanes, Functional Groups, Polymerization", order_index: 2 },
  { id: "topic-chemistry-inorganic-chemistry", slugKey: "chemistry", name: "Inorganic Chemistry", slug: "inorganic-chemistry", description: "Transition Metals, Coordination Compounds", order_index: 3 },
  { id: "topic-chemistry-physical-chemistry", slugKey: "chemistry", name: "Physical Chemistry", slug: "physical-chemistry", description: "Kinetics, Equilibrium, Acid-Base, Electrochemistry", order_index: 4 },
  { id: "topic-chemistry-biochemistry", slugKey: "chemistry", name: "Biochemistry", slug: "biochemistry", description: "Proteins, DNA/RNA, Enzymes, Metabolic Pathways", order_index: 5 },
];

async function main() {
  const db = getSupabaseAdmin();
  console.log("Starting Smart Taxonomy Seeding...\n");

  // 1. Load existing subjects by slug
  const { data: existingSubjects, error: subjectsError } = await db
    .from("subjects")
    .select("id, name, slug");

  if (subjectsError) {
    console.error("Failed to fetch subjects:", subjectsError.message);
    return;
  }

  const subjectBySlug = new Map<string, string>();
  for (const s of existingSubjects ?? []) {
    subjectBySlug.set(s.slug, s.id);
  }
  console.log("Existing subjects:", [...subjectBySlug.entries()].map(([slug, id]) => `${slug}=${id}`).join(", "));

  // 2. Ensure Math, Physics, Chemistry exist (upsert by slug)
  const CANONICAL = [
    { slug: "mathematics", name: "Math", description: "Mathematics, Algebra, Geometry, Calculus" },
    { slug: "physics", name: "Physics", description: "Mechanics, Electromagnetism, Thermodynamics, Optics" },
    { slug: "chemistry", name: "Chemistry", description: "Organic, Inorganic, Physical, Biochemistry" },
  ];

  for (const canon of CANONICAL) {
    if (!subjectBySlug.has(canon.slug)) {
      const { data: inserted, error } = await db
        .from("subjects")
        .insert({ id: generateId(), name: canon.name, slug: canon.slug, description: canon.description })
        .select("id")
        .single();
      if (error) {
        console.error(`Failed to insert subject ${canon.name}:`, error.message);
        return;
      }
      subjectBySlug.set(canon.slug, inserted.id);
      console.log(`- Inserted subject: ${canon.name} (id=${inserted.id})`);
    } else {
      console.log(`- Subject already exists: ${canon.slug} (id=${subjectBySlug.get(canon.slug)})`);
    }
  }

  // 3. Seed topics using actual subject IDs
  console.log("\nSeeding topics...");
  for (const topic of TOPICS_TO_SEED) {
    const subjectId = subjectBySlug.get(topic.slugKey);
    if (!subjectId) {
      console.error(`No subject found for slug "${topic.slugKey}" — skipping topic ${topic.name}`);
      continue;
    }

    const { error } = await db.from("topics").upsert(
      { id: topic.id, subject_id: subjectId, name: topic.name, slug: topic.slug, description: topic.description, order_index: topic.order_index },
      { onConflict: "id" }
    );

    if (error) {
      // If slug conflicts (topic already exists with different id), try upsert by slug
      if (error.message.includes("unique constraint")) {
        const { data: existing } = await db.from("topics").select("id").eq("subject_id", subjectId).eq("slug", topic.slug).maybeSingle();
        if (existing?.id) {
          console.log(`- Topic already exists: ${topic.name} (id=${existing.id})`);
          continue;
        }
      }
      console.error(`Failed to upsert topic ${topic.name}:`, error.message);
    } else {
      console.log(`- Upserted topic: ${topic.name} (subject=${topic.slugKey})`);
    }
  }

  // 4. Update session.service.ts constants - print the real IDs for reference
  console.log("\n--- Real Subject IDs (update session.service.ts if needed) ---");
  for (const [slug, id] of subjectBySlug.entries()) {
    if (["mathematics", "physics", "chemistry"].includes(slug)) {
      console.log(`${slug}: ${id}`);
    }
  }

  console.log("\nTaxonomy seeding complete!");
}

main().catch(console.error);
