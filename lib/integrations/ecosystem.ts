import type { AuthenticationMethod, IntegrationDefinition } from "@/lib/integrations/types";

export type EcosystemSeed={name:string;category:string;pack:string;packages?:string[];env?:string[];configs?:string[];auth?:AuthenticationMethod};
const groups:Record<string,string[]>={
 "ai":["Azure OpenAI","Amazon Bedrock","Mistral","Cohere","OpenRouter","Groq","Together AI","Fireworks AI","Replicate","Hugging Face","Ollama","LM Studio","DeepSeek","Qwen","Llama","xAI","Perplexity API"],
 "email":["Amazon SES","Mailgun","Postmark","Mailjet","Brevo","SparkPost","Elastic Email"],
 "communications":["Vonage","MessageBird","Telnyx","Plivo","WhatsApp Business","Telegram","Discord","Microsoft Teams","Signal","Pusher","Ably","Socket.IO","Firebase Cloud Messaging","OneSignal"],
 "authentication":["Auth0","Clerk","Supabase Auth","Firebase Authentication","Amazon Cognito","Microsoft Entra ID","Okta","WorkOS","Keycloak","FusionAuth","Lucia","NextAuth / Auth.js","Passport.js","Magic","Stytch","Descope","Google OAuth","Apple Sign-In","GitHub OAuth","Facebook Login","LinkedIn OAuth","SAML","OpenID Connect","LDAP"],
 "relational-database":["MariaDB","SQLite","Microsoft SQL Server","Oracle","CockroachDB","PlanetScale","Neon","Amazon Aurora","Amazon RDS","Google Cloud SQL","Azure SQL","TimescaleDB","TiDB","YugabyteDB"],
 "nosql-database":["MongoDB Atlas","Firestore","Firebase Realtime Database","Redis Cloud","Upstash","DynamoDB","Cassandra","ScyllaDB","Cosmos DB","CouchDB","Realm"],
 "search-vector":["Elasticsearch","OpenSearch","Algolia","Meilisearch","Typesense","Pinecone","Weaviate","Qdrant","Milvus","Chroma"],
 "payments":["PayPal","Square","Adyen","Checkout.com","Braintree","Authorize.Net","Worldpay","Fiserv","Cardknox","Sola","NMI","Cybersource","Elavon","Klarna","Affirm","Afterpay","Paddle","Lemon Squeezy","Chargebee","Recurly","Zuora","Plaid","Dwolla","Wise"],
 "cloud":["AWS","Microsoft Azure","Google Cloud","Cloudflare","DigitalOcean","Oracle Cloud","IBM Cloud","Render","Railway","Fly.io","Heroku","Netlify","Vercel","Firebase Hosting","Cloudflare Pages","GitHub Pages"],
 "aws":["S3","CloudFront","Lambda","API Gateway","SES","SNS","SQS","Secrets Manager","Parameter Store","RDS","DynamoDB","ECS","EKS","Elastic Beanstalk","CloudWatch","Route53"],
 "azure":["Azure App Service","Azure Functions","Azure SQL","Azure Blob Storage","Cosmos DB","Azure Key Vault","Azure Service Bus","Azure Container Apps","AKS","Application Insights"],
 "google-cloud":["Cloud Run","Cloud Functions","Google Cloud Storage","Cloud SQL","Firestore","BigQuery","Pub/Sub","Google Secret Manager","Vertex AI","Firebase"],
 "storage":["Amazon S3","Google Cloud Storage","Azure Blob Storage","Cloudinary","Uploadcare","Filestack","ImageKit","Bunny.net","Backblaze","Wasabi","MinIO","Supabase Storage","Firebase Storage"],
 "media":["Mux","Vimeo","YouTube API","Cloudinary","ImageKit","Bunny Stream"],
 "maps":["Google Maps","Mapbox","HERE","TomTom","OpenStreetMap"],
 "source-control":["GitLab","Bitbucket","Azure DevOps","Gitea"],
 "ci-cd":["GitHub Actions","GitLab CI","CircleCI","Jenkins","Buildkite","TeamCity","Travis CI","Azure Pipelines","Argo CD"],
 "monitoring":["Sentry","Datadog","New Relic","Grafana","Prometheus","LogRocket","Raygun","Rollbar","PagerDuty","Opsgenie"],
 "analytics":["Google Analytics","Google Tag Manager","Mixpanel","Amplitude","PostHog","Segment","Heap","Hotjar","FullStory","Plausible","Fathom","Matomo"],
 "feature-flags":["LaunchDarkly","Statsig","Split","Optimizely","GrowthBook"],
 "cms":["Contentful","Sanity","Strapi","Hygraph","Directus","WordPress","Ghost","DatoCMS"],
 "ecommerce":["Shopify","WooCommerce","BigCommerce","Magento","Medusa","Commerce Layer"],
 "business":["Salesforce","HubSpot","Zoho","Microsoft Dynamics","NetSuite","SAP","QuickBooks","Xero","ServiceNow","Zendesk","Intercom","Freshdesk"],
 "productivity":["Jira","Linear","Asana","Monday.com","Trello","Notion","Airtable","ClickUp","Dropbox","Google Drive","OneDrive","Box"],
 "documents":["DocuSign","Adobe Sign","HelloSign"],
 "data-layer":["Prisma","Drizzle","TypeORM","Sequelize","Mongoose","Knex","Doctrine","Hibernate","Entity Framework Core","SQLAlchemy","Django ORM","Laravel Eloquent","Ecto"],
 "package-registry":["npm","NuGet","PyPI","RubyGems","Maven Central","Gradle Plugin Portal","Cargo","Go Modules","Packagist","Homebrew","Chocolatey","Winget"],
 "infrastructure":["Docker","Docker Compose","Kubernetes","Terraform","Pulumi","Ansible","Helm","Vagrant"],
 "mobile":["Google Play Console","Apple App Store Connect","Firebase App Distribution","Expo","Fastlane"],
 "gaming":["Steamworks","Epic Online Services","Unity Gaming Services","PlayFab","Photon"],
 "iot":["MQTT","RabbitMQ","Kafka","Azure IoT","AWS IoT","Serial","USB HID","Bluetooth LE","NFC"],
 "payment-hardware":["PAX","Verifone","ID TECH","Ingenico","MagTek","Miura","Dejavoo","Castles","Newland","Clover","Square Terminal","Stripe Terminal","Adyen Terminal"],
};
const special:Record<string,Partial<EcosystemSeed>>={
 "Auth0":{packages:["@auth0/nextjs-auth0","auth0"],env:["AUTH0_SECRET","AUTH0_CLIENT_ID","AUTH0_CLIENT_SECRET","AUTH0_ISSUER_BASE_URL"],auth:"oidc"},
 "Clerk":{packages:["@clerk/nextjs","@clerk/clerk-react"],env:["CLERK_SECRET_KEY","NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],auth:"api-key"},
 "AWS":{packages:["@aws-sdk/client-s3","aws-sdk"],env:["AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_REGION"],configs:["serverless.yml","samconfig.toml"],auth:"workload-identity"},
 "Microsoft Azure":{packages:["@azure/identity"],env:["AZURE_CLIENT_ID","AZURE_TENANT_ID","AZURE_CLIENT_SECRET"],auth:"workload-identity"},
 "Google Cloud":{packages:["google-auth-library","@google-cloud/storage"],env:["GOOGLE_APPLICATION_CREDENTIALS","GOOGLE_CLOUD_PROJECT"],auth:"workload-identity"},
 "PayPal":{packages:["@paypal/paypal-server-sdk","@paypal/checkout-server-sdk"],env:["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET"],auth:"oauth"},
 "Sentry":{packages:["@sentry/nextjs","@sentry/node","sentry-sdk","sentry_sdk"],env:["SENTRY_DSN","SENTRY_AUTH_TOKEN"],configs:["sentry.properties"],auth:"access-token"},
 "GitLab":{packages:["@gitbeaker/rest"],env:["GITLAB_TOKEN"],configs:[".gitlab-ci.yml"],auth:"oauth"},
 "Docker":{configs:["Dockerfile"],auth:"none"},"Docker Compose":{configs:["docker-compose.yml","compose.yml"],auth:"none"},"Kubernetes":{configs:["kustomization.yaml","Chart.yaml"],auth:"local-provider"},"Terraform":{configs:[".terraform.lock.hcl",".tf",".tfvars"],auth:"local-provider"},
};
export function slug(name:string){return name.toLowerCase().replace(/\+/g," plus ").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function defaultPackage(name:string){return slug(name).replace(/-/g,"-");}
function defaultEnv(name:string){return `${slug(name).replace(/-/g,"_").toUpperCase()}_API_KEY`;}
export const ecosystemSeeds:EcosystemSeed[]=Object.entries(groups).flatMap(([category,names])=>names.map(name=>({name,category,pack:category,...special[name]})));
export function metadataDefinition(seed:EcosystemSeed):IntegrationDefinition{const id=slug(seed.name);const auth=seed.auth||"api-key";const env=seed.env||((auth==="none"||auth==="local-provider")?[]:[defaultEnv(seed.name)]);return {id,name:seed.name,category:seed.category,pack:seed.pack,auth,authenticationMethods:[auth],preferredAuthenticationMethod:auth,fields:env.map((name,index)=>({key:index?slug(name):"credential",label:name.replace(/_/g," "),env:[name],required:index===0,secret:/(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/.test(name)})),packages:seed.packages||[defaultPackage(seed.name)],imports:seed.packages||[defaultPackage(seed.name)],sourcePatterns:[seed.name,...env],configFiles:seed.configs||[],conventions:[],help:`Foundry can detect ${seed.name} project usage. A provider-specific guided adapter is not certified yet.`,deploymentMappings:Object.fromEntries(env.map(name=>[name,name])),troubleshooting:["Verify the project-specific configuration and environment mapping.","Use a least-privilege credential for the active environment."],maturity:"metadata"};}
