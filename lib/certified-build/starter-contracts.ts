export const CERTIFIED_STARTER_KINDS = {
  inventory: "Inventory management system",
  commerce: "E-commerce store",
  pos: "Point-of-sale app",
  dashboard: "Operational dashboard",
  website: "Responsive website",
  mobile: "Mobile app",
  game: "Playable game",
  api: "API service",
  ai: "AI application",
  desktop: "Desktop application",
  custom: "Custom software project",
} as const;

export type CertifiedStarterId = keyof typeof CERTIFIED_STARTER_KINDS;

export const CERTIFIED_STARTER_SUBTYPES: Record<CertifiedStarterId, string[]> = {
  inventory: ["Retail inventory","Warehouse inventory","Manufacturing inventory","Medical/pharmacy inventory","Restaurant inventory","Clothing/apparel inventory","Asset tracking","Small business inventory","Enterprise inventory"],
  commerce: ["Clothing store","Grocery","Digital products","Wholesale","Subscription"],
  pos: ["Retail POS","Restaurant POS","Service business","Cardknox/payment SDK"],
  dashboard: ["Operations dashboard","Sales dashboard","Inventory dashboard","Finance dashboard","Executive dashboard"],
  website: ["Marketing site","Portfolio","Product page","Docs site","Business website"],
  mobile: ["Consumer mobile app","Field operations app","Internal business app","Companion app","Mobile commerce app"],
  game: ["2D arcade game","Puzzle game","Platformer","Card/board game","Educational game"],
  api: ["REST API","GraphQL API","Internal microservice","Public developer API","Webhook/integration service","Auth/identity service","Data processing API"],
  ai: ["Chat assistant","Document Q&A / RAG","Agentic workflow","Content generation tool","AI-powered internal tool","Voice/multimodal app"],
  desktop: ["Internal business tool","Data entry / forms tool","Utility / productivity tool","Creative or media tool","POS/register terminal","Monitoring/dashboard tool"],
  custom: ["Web app","Business app","Internal tool","AI app","Backend/API","Desktop app"],
};

export function certifiedStarterSeed(id: CertifiedStarterId, subtype: string) {
  return id === "custom" ? subtype : `${CERTIFIED_STARTER_KINDS[id]}. Subtype: ${subtype}`;
}
