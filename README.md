# Paragon Academy

Paragon Academy is a responsive course-based learning platform built with React, Vite, Express, and SQLite. It provides separate Owner, Teacher, and Student workspaces. The Owner manages users, courses, permissions, subscriptions, payment reviews, and platform settings; Teachers work only in assigned courses and within permissions granted by the Owner; Students browse courses and access learning materials after a course subscription is active.

## Local development

Install dependencies with `npm install`. Create an ignored local `.env` from `.env.example` and set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` before starting the API. Student signup creates the account and signs the student in directly without email verification. Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` only if you want email-based password resets. The sender address must belong to a domain verified in Resend. Do not commit local environment files or production credentials.

Start the API and frontend together:

```powershell
npm run dev
```

Open `http://localhost:5173` to view the public learning overview. Students and teachers use the sign-in page; Owner sign-in is separate at `/admin` and is not offered in the student/teacher role picker. The development command starts the API and Vite frontend together; Vite proxies `/api` requests to the API port (`3001` by default, or `API_PORT` if configured). To run the services separately, use `npm run api` and `npm run dev:frontend` in separate terminals. Development test sessions and course-purchase shortcuts are available only when `NODE_ENV` is not `production` and `ALLOW_DEV_SESSIONS=true`.

## Courses and protected media

- An Owner creates a course, labels its subject and class/grade level, sets its price and subscription duration, then organizes chapters with optional topic labels and protected lecture/PDF materials.
- Teachers are provisioned by the Owner and can only access assigned courses/chapters and explicitly granted permissions.
- Students purchase a complete course package; individual videos and PDFs are not sold separately.
- The Owner configures one or more manual payment methods and publishes the payment instructions/account details. At checkout, students choose a method, enter the payer name and transaction reference, and submit a payment screenshot. Requests stay pending until the Owner checks the proof and approves or rejects them; approval activates the complete course subscription and rejection keeps course media locked. Course coupons can be global or course-scoped, fixed-amount or percentage discounts, with expiry and redemption limits; full-discount coupons unlock access immediately.
- Media is stored outside the public web root and streamed through authenticated endpoints. The application checks the viewer's course access before serving a file.
- Videos support MP4, WebM, and MOV up to 5 GB each, with no fixed lecture-count cap. PDFs are limited to 100 MB each. The default total media quota is 500 GB; configure it with `MAX_STORAGE_BYTES`.
- Video progress is saved while a Student watches. Certificates can be issued after all course lessons are complete and each published assessment has a submitted attempt. Issued certificates have public verification codes and a print-friendly page.

The development-only test purchase does not charge money. Manual payment verification is available; no payment gateway or automated payment reconciliation is integrated. Password-reset codes are sent through Resend and require a valid `RESEND_API_KEY` and verified `RESEND_FROM_EMAIL` configured on the API server. Signup does not use email delivery or verification. SMS/WhatsApp delivery and cloud/object storage also need a provider, deployment policy, and credentials before they can be enabled. Live classes use external HTTP(S) meeting links and manually recorded attendance; authorized staff can link an uploaded course lecture as the class recording. Authenticated streaming protects access but cannot prevent a viewer from capturing media delivered to their device.

## LMS features

- Owner-managed Teacher accounts, course/chapter assignments, and per-Teacher permissions.
- Owner student directory and account activation controls.
- Course chapters, lectures, PDFs, course publishing, subscription management, and private media storage.
- Course quizzes and tests with multiple-choice questions, randomization, time limits, automatic scoring, and attempt history.
- Course assignments with written student submissions, teacher/Owner grading, and feedback notifications.
- Course discussion threads and replies, with course-access checks and Owner/permissioned-Teacher moderation.
- Private student-to-assigned-teacher question threads, Owner-controlled Teacher opt-in, and in-app reply notifications.
- Student opt-in course leaderboards. Only the Student's first name and a transparent learning score are shown; the score combines course lesson completion and assessment averages.
- Lecture progress and Owner/authorized Teacher progress reports.
- Scheduled live classes, student notifications/announcements, student attendance history, and protected recordings linked to course lectures.
- Course/lecture/Teacher feedback, authorized replies, and notifications.
- Owner analytics for users, courses, subscriptions, payments, assessments, and feedback, plus course-scoped teacher performance reports.
- Completion certificates with public code verification, optional learning leaderboards, course coupons, and subject/topic organization.
- Responsive Student, Teacher, and Owner views.

## API and deployment

SQLite data and private media use `API_DATA_DIR` and `MEDIA_STORAGE_DIR` (defaults are under `server/`). `GET /api/health` reports API and storage health. The authenticated media endpoint is `GET /api/content/:id/stream`.

### Deploy frontend to Vercel and API to Railway

The included `vercel.json` builds the Vite frontend, routes `/api/*` to Railway, and preserves client-side routes. Configure the Railway API service in its dashboard; attach a persistent volume for both SQLite and private course uploads. SQLite requires one API replica.

1. Push the repository to GitHub. In Railway, create a project and deploy a service from the GitHub repository. Set the service root directory to the repository root and the start command to `npm run api`.
2. Add a persistent volume to the API service and mount it at `/data`. In the service's Variables settings, set `NODE_ENV=production`, `ALLOW_DEV_SESSIONS=false`, `API_DATA_DIR=/data/data`, `MEDIA_STORAGE_DIR=/data/storage`, `MAX_STORAGE_BYTES=9663676416`, `ADMIN_EMAIL`, and a strong unique `ADMIN_PASSWORD`; optionally set `ADMIN_NAME`. Keep production secrets out of GitHub. The Owner account is created on first startup when its variables are present.
3. In Railway service Settings > Networking, generate a public domain. Wait for the API to become healthy by opening `https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/health`.
4. Replace the placeholder host in the API rewrite destination in `vercel.json` with the exact Railway domain, then commit and push that change. For example, if Railway shows `paragon-api-production-1234.up.railway.app`, the destination should be `https://paragon-api-production-1234.up.railway.app/api/$1`.
5. Import the same GitHub repository in Vercel using the repository root. Use `npm run build` and `dist` as the output directory. Deploy after the Railway URL has been added to `vercel.json`.
6. Open the Vercel deployment and verify `/`, `/signin`, `/signup`, and `/admin`. Sign in as Owner using the Railway `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

The Vercel rewrite keeps browser API requests same-origin, allowing the production session cookie to work without exposing credentials to frontend code. Do not remove the `/api/(.*)` rewrite. Do not scale the Railway API to multiple replicas when using SQLite. Back up the SQLite database and private uploads independently. Increase Railway volume capacity and `MAX_STORAGE_BYTES` together if you need more than the configured 9 GiB media quota. Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Railway only if password-reset email is required.

Configure a real payment provider and external notification/conferencing services before relying on those integrations. Attendance is staff-marked and is not verified by the meeting provider. Assignment responses are text-only. The configured `MAX_STORAGE_BYTES` is an application quota, not a cloud storage contract.
