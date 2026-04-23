import "dotenv/config";
import { KnowledgeGraphManager } from "./src/memory/knowledge-graph/manager.js";

(async () => {
  const kgm = new KnowledgeGraphManager("user_admin", undefined, process.env.GRAPH_STORE_BACKEND || "mysql");
  try {
    await kgm.onFactStored({
      id: "test_doc_123",
      key: "kb:TestDocument.pdf",
      value: "Test content",
      tags: ["kb_document", "pdf"],
    });
    console.log("onFactStored succeeded");
    const store = await kgm.getStore();
    const nodes = await store.getAllNodes();
    console.log("Nodes in store:", nodes.length);
    nodes.slice(0, 3).forEach(n => console.log(n.id, n.label));
  } catch (e: any) {
    console.error("Error:", e.message);
  }
  process.exit(0);
})();
