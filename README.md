# avatarindia-backend
## Avatar India Backend

This is the backend codebase for the [Avatar India](https://avatarindia.org/) Society, a group of Interventional Nephrologists, Radiologists, and Renal Physicians. 

The mission of AVATAR India is to encourage and advance knowledge, foster clinical and experimental research, support scholarship programs, and facilitate growth in the fields of Hemodialysis, Peritoneal Dialysis, and Interventional Nephrology.

### Features

- **User Authentication & Authorization**  
  Secure endpoints using JWT and role-based access for admins, members, and guests.

- **Board Member Management**  
  CRUD APIs to manage board member profiles, including:  
  - Name, designation, profile picture, description  
  - Contact information and social links

- **Role Management**  
  Create, update, and delete user roles with different access privileges in the system.

- **Logging & Reporting**  
  Activity logs for auditing and administrative transparency.

- **Rate Limiting and Security**  
  Basic security measures like rate-limiting for sensitive actions including login.

- **Extensible Schema**  
  Designed to add more features, e.g. research publication sharing, scholarship entries, etc.

### Tech Stack

- **Node.js**  
- **Express.js**  
- **MongoDB** (Mongoose ODM)
- **JWT** for authentication
- **bcryptjs** for password hashing
- **express-rate-limit** for rate limiting

### Getting Started

1. **Clone the repository**
   ```
   git clone https://github.com/your-org/avatarindia-backend.git
   cd avatarindia-backend
   ```

2. **Install dependencies**
   ```
   npm install
   ```

3. **Set up environment variables**  
   Create a `.env` file in the root with the following keys:
   ```
   MONGO_URL=your_mongodb_connection_string
   TOKEN_SECRET=your_secret_key
   ```

4. **Run the server**
   ```
   npm start
   ```

### Folder Structure

```
├── models/           # Mongoose schemas for BoardMember, User, Role, etc.
├── routes/           # Express route handlers (auth, boardmember, role, etc.)
├── validation/       # Data validation logic (e.g. Joi schemas)
├── .env              # Environment variables (not committed)
├── app.js / index.js # Entry point
```

### API Overview

- `POST /api/auth/register` — Register new users
- `POST /api/auth/login` — Authenticate and obtain JWT
- `GET /api/auth/check` — Validate session
- `CRUD /api/boardmember` — Manage board members
- `CRUD /api/role` — Manage user roles

### Contribution

Feel free to contribute to this project by submitting pull requests or feature suggestions!

### License

MIT

---

**AVATAR India Society**  
Promoting Research & Knowledge in Hemodialysis, Peritoneal Dialysis, and Interventional Nephrology

