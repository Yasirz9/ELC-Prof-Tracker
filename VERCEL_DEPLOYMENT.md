# 🚀 Vercel Deployment Guide

## Complete Step-by-Step Instructions for ELC-Prof-Tracker

---

## Prerequisites ✅

- [x] GitHub account (already have)
- [x] Vercel account (free at [vercel.com](https://vercel.com))
- [x] Supabase project (already setup in README)
- [x] Environment variables from Supabase

---

## Step 1: Prepare Vercel Account

### 1.1 Sign up / Login
```bash
# Go to https://vercel.com
# Sign in with GitHub (Recommended)
```

### 1.2 Create Team (Optional)
```
Dashboard → Settings → Teams → Create Team → Name: "PTCL-ELC"
```

---

## Step 2: Deploy Project

### 2.1 Add Project
```
1. Click "Add New" → "Project"
2. Select "Import Git Repository"
3. Search & select: Yasirz9/ELC-Prof-Tracker
4. Click "Import"
```

### 2.2 Configure Project
```
Project Name: elc-prof-tracker
Framework Preset: Other (auto-detected as Vite)
Root Directory: ./ (default)
Build Command: (auto-detected)
Output Directory: .output/public (for Cloudflare build)
```

### 2.3 Add Environment Variables 🔐

**CRITICAL:** Add all 4 variables from your Supabase project

```
VITE_SUPABASE_URL = https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = eyJhbGc...
SUPABASE_URL = https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJhbGc...
```

**How to find these:**
1. Go to [supabase.com](https://supabase.com) → Your Project
2. Settings → API
3. Copy the values from there

### 2.4 Click Deploy!
```
✓ Deployment started
⏳ Building... (2-3 minutes)
✅ Live at: https://elc-prof-tracker.vercel.app
```

---

## Step 3: Verify Deployment

### 3.1 Check Live App
```bash
# Open in browser:
https://elc-prof-tracker.vercel.app

# Should show:
- Public upload page working
- Can lookup customer by MDN
- Admin login page accessible
```

### 3.2 Test Admin Login
```
Email: muhammad.yasir7@ptclgroup.com
Password: Yasir@123

✓ Should see Overview tab with KPIs
✓ Can access all admin features
```

### 3.3 Monitor Deployment
```
Dashboard → Your Project → Deployments

View:
- Build logs
- Runtime logs
- Environment variables (masked)
- Deployment history
```

---

## Step 4: Setup Continuous Deployment

### 4.1 GitHub Integration (Auto-enabled)
```
Every push to 'main' branch → Auto-deploys to Vercel

Flow:
main branch → GitHub push → Vercel auto-detects → Deploy
```

### 4.2 Deploy Previews
```
1. Create a new branch: git checkout -b feature/new-feature
2. Push: git push origin feature/new-feature
3. Create Pull Request on GitHub
4. Vercel auto-creates preview URL
5. Test before merging to main
6. Merge to main → Production deploy
```

### 4.3 Rollback (If needed)
```
Dashboard → Deployments → Click past deployment → "Redeploy"
```

---

## Step 5: Custom Domain (Optional)

### 5.1 Add Domain
```
Settings → Domains → Add Domain

Options:
1. Use Vercel's free domain: elc-prof-tracker.vercel.app
2. Connect custom domain (requires domain registrar)
```

### 5.2 If using Custom Domain
```bash
# At your domain registrar (GoDaddy, Namecheap, etc.)
# Add CNAME record:
Name: your-domain.com
Value: cname.vercel-dns.com

# Wait 5-10 minutes for DNS propagation
```

---

## Step 6: Environment Variables - Reference

### Development (`.env.local`)
```bash
# Used when running: npm run dev
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGc...
```

### Production (Vercel Dashboard)
```bash
# Set in: Settings → Environment Variables
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGc...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

### Why 4 variables?
```
- VITE_* → Visible to browser (public)
- SUPABASE_URL → Supabase endpoint
- SUPABASE_SERVICE_ROLE_KEY → Admin key (server-only, hidden from browser)
```

---

## Troubleshooting 🔧

### Issue: "Build Failed"
```
Solution:
1. Check build logs in Vercel dashboard
2. Common causes:
   - Missing environment variables
   - TypeScript errors
   - Dependency conflicts
3. Fix locally:
   npm run build
4. Push to GitHub
5. Vercel auto-redeploys
```

### Issue: "Cannot connect to Supabase"
```
Solution:
1. Verify all 4 env vars are set
2. Check Supabase URL is correct (no trailing slash)
3. Verify keys are not expired
4. Check Supabase project is "Active"
5. Settings → API → Confirm keys match
```

### Issue: "Admin login not working"
```
Solution:
1. Verify SUPABASE_SERVICE_ROLE_KEY is set
2. Check Supabase auth table has admin user
3. Test on local dev: npm run dev
4. If local works but production doesn't:
   - Clear browser cache
   - Try different browser
   - Check browser console for errors
```

### Issue: "File upload fails"
```
Solution:
1. Verify SUPABASE_SERVICE_ROLE_KEY (needed for storage)
2. Check Supabase Storage bucket permissions:
   Storage → payment-proofs → Permissions → Row Level Security
3. Verify bucket policy allows uploads
```

### Issue: "Deployment too slow"
```
Solution:
1. Check node_modules size: npm list --depth=0
2. Optimize dependencies:
   npm audit
   npm update
3. Use .vercelignore to exclude unnecessary files
4. Enable Vercel's caching:
   Settings → Build Cache → Enable
```

---

## Performance Optimization 🚀

### Enable Vercel Caching
```
Settings → Build & Development Settings → Enable Build Cache

Benefit: Faster rebuilds (reuse dependencies from previous builds)
```

### Setup Analytics
```
Settings → Analytics → Enable Web Analytics

Monitor:
- Page load times
- User interactions
- Error rates
- Core Web Vitals
```

### Enable Edge Middleware (Advanced)
```
Create: middleware.ts

Benefit: Redirect, rewrite, or validate requests at Vercel edge (super fast)
```

---

## Security Best Practices 🔐

### 1. Never commit `.env` files
```bash
# Verify in .gitignore:
echo .env.local >> .gitignore
git add .gitignore
git commit -m "Ensure env files are ignored"
```

### 2. Rotate service role key regularly
```bash
# Every 3 months:
# 1. Go to Supabase → Settings → API
# 2. Click "Regenerate" on SUPABASE_SERVICE_ROLE_KEY
# 3. Update in Vercel: Settings → Environment Variables
# 4. Redeploy
```

### 3. Enable CORS Protection
```bash
# In Supabase:
# Settings → API → CORS Allowed Origins
# Add: https://elc-prof-tracker.vercel.app
```

### 4. Setup Authentication
```bash
# Vercel supports:
# - GitHub OAuth
# - Passwordless auth
# - IP whitelisting
```

### 5. Monitor Logs
```bash
# View all access logs:
# Vercel Dashboard → Logs → Runtime Logs
```

---

## Pricing 💰

### Vercel (FREE Tier)
```
✓ Unlimited deployments
✓ 100GB bandwidth/month
✓ Up to 12 serverless functions
✓ Includes Edge Middleware
✓ Free HTTPS
✓ Automatic SSL certificates

Pro Plan: $20/month (if exceeding limits)
```

### Supabase (FREE Tier)
```
✓ 500MB storage
✓ 1GB bandwidth
✓ Auth included
✓ Real-time subscriptions
✓ 50 concurrent connections

Pro Plan: $25/month + overage (if needed)
```

### Total Cost: **₹0/month** 🎉

For a regional PTCL project with 1000s of proofs, free tier should work fine for 6+ months.

---

## Advanced: Using Vercel CLI (Optional)

### Install CLI
```bash
npm install -g vercel
```

### Link Project
```bash
cd ELC-Prof-Tracker
vercel link
# Selects your project
```

### Deploy from CLI
```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### Pull Environment Variables
```bash
vercel env pull .env.local
# Downloads all env vars for local dev
```

---

## Next Steps 📋

### After Deployment
- [ ] Test all features on production
- [ ] Share live URL with admins
- [ ] Monitor error rates for 1 week
- [ ] Gather feedback from users
- [ ] Review deployment logs
- [ ] Setup monitoring (Sentry, LogRocket)
- [ ] Implement suggested improvements (see `IMPROVEMENTS.md`)

---

## Support & Resources 📚

| Resource | URL |
|---|---|
| Vercel Docs | https://vercel.com/docs |
| Supabase Docs | https://supabase.com/docs |
| TanStack Start | https://tanstack.com/start |
| Vite Build Tool | https://vitejs.dev |
| Cloudflare Workers | https://workers.cloudflare.com |

---

## Questions?

💬 For support:
1. Check logs in Vercel Dashboard
2. Review error message
3. Search Vercel docs
4. Contact Vercel Support (for paid plans)
5. Check Supabase status page

---

**Happy deploying! 🚀**
