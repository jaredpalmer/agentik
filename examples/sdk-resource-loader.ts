import { DefaultResourceLoader } from "@agentik/runtime";

const loader = new DefaultResourceLoader({ cwd: process.cwd() });
await loader.reload();

const { agentsFiles } = loader.getAgentsFiles();
console.log("Context files:");
for (const file of agentsFiles) {
  console.log(`- ${file.path}`);
}

const { skills } = loader.getSkills();
console.log(`Loaded ${skills.length} skills.`);

const { prompts } = loader.getPrompts();
console.log(`Loaded ${prompts.length} prompt templates.`);
