const mockRecoveryResponse = {
  "tree": [
    {
      "id": "root",
      "parentId": null,
      "title": "ដោះស្រាយប្រព័ន្ធសមីការដោយក្រាហ្វ",
      "description": "ដើម្បីដោះស្រាយប្រព័ន្ធសមីការ $y = x + 2$ និង $y = x^2 - 4$ ដោយប្រើក្រាហ្វ យើងត្រូវគូសបន្ទាត់ត្រង់ និងប៉ារ៉ាបូលនៅលើប្រព័ន្ធកូអរដោនេដូចគ្នា រួចរកចំណុចប្រសព្វរបស់វា។",
      "mathContent": "$$\\begin{aligned} y &= x + 2 \\\\ y &= x^2 - 4 \\end{aligned}$$",
      "subject": "Math"
    },
    {
      "id": "branch1",
      "parentId": "root",
      "title": "គូសក្រាហ្វបន្ទាត់ត្រង់",
      "description": "សម្រាប់សមីការបន្ទាត់ត្រង់ $y = x + 2$ យើងអាចរកចំណុចពីរដើម្បីគូសបន្ទាត់។",
      "mathContent": "$$y = x + 2$$"
    },
    {
      "id": "leaf1_1",
      "parentId": "branch1",
      "title": "រកចំណុចសម្រាប់បន្ទាត់ត្រង់",
      "description": "យើងរកចំណុចកាត់អ័ក្ស x និង y ដើម្បីគូសបន្ទាត់ត្រង់។",
      "mathContent": "$$\\begin{aligned} \\\\ \\text{នៅពេល } x = 0: & \\quad y = 0 + 2 = 2 \\Rightarrow (0, 2) \\\\ \\text{នៅពេល } y = 0: & \\quad 0 = x + 2 \\Rightarrow x = -2 \\Rightarrow (-2, 0) \\end{aligned}$$"
    },
    {
      "id": "branch2",
      "parentId": "root",
      "title": "គូសក្រាហ្វប៉ារ៉ាបូល",
      "description": "សម្រាប់សមីការប៉ារ៉ាបូល $y = x^2 - 4$ យើងត្រូវរកកំពូល និងចំណុចកាត់អ័ក្ស។",
      "mathContent": "$$y = x^2 - 4$$"
    },
    {
      "id": "leaf2_1",
      "parentId": "branch2",
      "title": "រកកំពូល និងចំណុចកាត់អ័ក្ស",
      "description": "គណនាកំពូល ចំណុចកាត់អ័ក្ស y និងចំណុចកាត់អ័ក្ស x នៃប៉ារ៉ាបូល។",
      "mathContent": "$$\\begin{aligned} \\text{កំពូល: } & x = -\\frac{b}{2a} = -\\frac{0}{2(1)} = 0 \\\\ & y = (0)^2 - 4 = -4 \\Rightarrow (0, -4) \\\\ \\text{ចំណុចកាត់អ័ក្ស y: } & x = 0 \\Rightarrow y = -4 \\Rightarrow (0, -4) \\\\ \\text{ចំណុចកាត់អ័ក្ស x: } & y = 0 \\Rightarrow x^2 - 4 = 0 \\Rightarrow x^2 = 4 \\Rightarrow x = \\pm 2 \\Rightarrow (-2, 0), (2, 0) \\end{aligned}$$"
    }
  ]
};

function isUsableProblemBreakdown(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as any;

  if (!Array.isArray(candidate.nodes) && Array.isArray(candidate.tree)) {
    candidate.nodes = candidate.tree;
  }
  if (!Array.isArray(candidate.nodes) && Array.isArray(candidate.steps)) {
    candidate.nodes = candidate.steps;
  }

  if (!Array.isArray(candidate.nodes) || candidate.nodes.length < 5) return false;

  const rootNode = candidate.nodes.find((n: any) => n?.id === "root" || n?.parentId == null);
  if (rootNode) {
    if (!candidate.title && rootNode.title) candidate.title = rootNode.title;
    if (!candidate.title && rootNode.label) candidate.title = rootNode.label;
    if (!candidate.subject && rootNode.subject) candidate.subject = rootNode.subject;
  }
  if (!candidate.title) candidate.title = "Problem Breakdown";
  if (!candidate.subject) candidate.subject = "Math";
  if (!candidate.insights) {
    candidate.insights = { simpleBreakdown: "", keyFormula: "" };
  }

  let branchNodes = candidate.nodes.filter((node: any) => node?.type === "branch");
  if (branchNodes.length < 2) {
    branchNodes = candidate.nodes.filter(
      (node: any) => node?.parentId === "root" || (node?.id !== "root" && !node?.type)
    );
  }
  if (branchNodes.length < 2) return false;

  const hasConcreteBranch = branchNodes.some((node: any) => {
    const math = `${node?.mathContent ?? ""}`.trim();
    const desc = `${node?.description ?? ""}`.trim();
    if (!math && !desc) return false;
    return (math.length >= 8 || desc.length >= 18);
  });

  return hasConcreteBranch;
}

const usable = isUsableProblemBreakdown(mockRecoveryResponse);
console.log("IS USABLE:", usable);
console.log("FINAL OBJECT:", mockRecoveryResponse);
