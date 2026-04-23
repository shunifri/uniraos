import { GraphStore } from "./src/memory/knowledge-graph/graph-store.js";

(async () => {
  const store = new GraphStore("user_admin");
  try {
    const node = await store.addNode({ id: "test_node_3", label: "Test Node 3", type: "test", tags: ["test"], properties: { value: "hello" } });
    console.log("Added node:", node.id);
    const found = await store.getNode("test_node_3");
    console.log("Found node:", found?.label);
    const count = await store.getAllNodes();
    console.log("Total nodes:", count.length);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
  process.exit(0);
})();
