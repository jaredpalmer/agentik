import { Agent, InMemoryAuthStore, ModelRegistry } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// Register a model factory that can use API keys from the auth store.
const authStore = new InMemoryAuthStore();
await authStore.set("mock-provider", "mock-key");

const registry = new ModelRegistry(authStore);
registry.registerModel({
  id: "mock-model",
  providerId: "mock-provider",
  createModel: ({ apiKey }) => {
    console.log("Resolved API key:", apiKey ?? "none");
    return createMockModel("Hello from the model registry.");
  },
});

const model = await registry.resolveModel("mock-model");
const agent = new Agent({ model });

agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

await agent.prompt("Say hi.");
process.stdout.write("\n");
