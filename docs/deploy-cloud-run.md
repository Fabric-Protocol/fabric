# Deploy to GCP Cloud Run (Container)

## Prereqs
- `gcloud` CLI installed
- Logged in to Google Cloud
- Active project selected

PowerShell:
```powershell
gcloud auth login
gcloud config set project <PROJECT_ID>
```

## Build and deploy (recommended path: Docker build + deploy)
```powershell
gcloud builds submit --tag gcr.io/<PROJECT_ID>/fabric-api
gcloud run deploy fabric-api --image gcr.io/<PROJECT_ID>/fabric-api --region us-west1 --platform managed --allow-unauthenticated=false
```

## Set required runtime env vars
Use placeholders only, then replace with real values in your environment:
```powershell
gcloud run services update fabric-api --region us-west1 --set-env-vars "DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres,ADMIN_KEY=[ADMIN_KEY],STRIPE_SECRET_KEY=[STRIPE_SECRET_KEY],STRIPE_WEBHOOK_SECRET=[STRIPE_WEBHOOK_SECRET]"
```

## Optional always-on setting
- To reduce cold starts, set minimum instances to `1`:
```powershell
gcloud run services update fabric-api --region us-west1 --min-instances 1
```
