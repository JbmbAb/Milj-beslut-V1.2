# Project Plan Editor

**Datum:** 2026-04-02 | **Status:** ✅ IMPLEMENTERAD

---

## 📋 OVERVIEW

**Project Plan Editor** är en interaktiv editör där användare kan:

- ✅ **Lägga till** nya objekt (faser, risker, intressenter)
- ✅ **Redigera** befintliga objekt från AI
- ✅ **Ta bort** objekt de inte behöver
- ✅ **Omordna** via drag-and-drop
- ✅ **Spara** den anpassade planen

Editorn fungerar tillsammans med **ProjectPlanGenerator** i ett **två-stegs workflow**:

1. **Generator**: AI analyserar input → genererar plan
2. **Editor**: Användare anpassar plan fritt → sparar

---

## 🎯 KEY FEATURES

### ✅ Full CRUD Operations

```
READ:    Se AI-genererad data
CREATE:  Lägg till nya faser/risker/intressenter
UPDATE:  Redigera namn, datum, budget, etc.
DELETE:  Ta bort objekt
```

### ✅ Drag-and-Drop

```
- Omordna faser genom att dra dem
- Omordna risker för prioritering
- Intuitiv grephantering
```

### ✅ Three Tabs

| Tab              | Innehål                                      |
| ---------------- | -------------------------------------------- |
| **Faser**        | Projektfaser (namn, datum, budget, resurser) |
| **Risker**       | Riskanalys (kategori, sannolikhet, åtgärd)   |
| **Intressenter** | Stakeholders (inflytande, kommunikation)     |

### ✅ Real-time Validation

```
- Datumvalidering (startdatum ≤ slutdatum)
- Budget-nummer
- Obligatoriska fält
- Visuell feedback
```

### ✅ Intelligent State Management

```
- Alla ändringar lagras i state
- Spara/Avbryt-knappar
- Erfolg/Felmeddelanden
- Auto-reset efter sparning
```

---

## 🔧 ARCHITECTURE

### Component Tree

```
ProjectPlanModule
├── ProjectPlanGeneratorWithEditor (wrapper)
│   ├── ProjectPlanGenerator (step 1: generate)
│   └── ProjectPlanEditor (step 2: edit)
│       ├── Tabs (phases/risks/stakeholders)
│       ├── Items List (with CRUD)
│       └── Action Buttons (Save/Cancel)
```

### Data Flow

```
AI genererar plan
   ↓
ConvertToEditablePlan() - Transform GeneratedPlan → EditablePlan
   ↓
ProjectPlanEditor renders
   ↓
User makes changes (add/edit/delete)
   ↓
handleEditorSave()
   ↓
POST /api/projects/:projectId/plan
   ↓
Backend saves plan
   ↓
Success! Display confirmation
```

---

## 📝 COMPONENT: ProjectPlanEditor

### Props

```typescript
interface ProjectPlanEditorProps {
  initialPlan: EditablePlan; // AI-generated or loaded plan
  onSave: (plan: EditablePlan) => Promise<void>; // Save handler
  onCancel?: () => void; // Cancel handler
}
```

### State

```typescript
plan: EditablePlan; // Current plan being edited
activeTab: TabType; // 'phases' | 'risks' | 'stakeholders'
editingId: string | null; // Currently edited item
draggedId: string | null; // Item being dragged
isSaving: boolean; // Save in progress
error: string | null; // Error message
success: boolean; // Show success message
```

### Methods

```typescript
// Phases
addPhase(); // Create new phase
removePhase(id); // Delete phase
updatePhase(id, updates); // Edit phase
movePhase(fromIdx, toIdx); // Reorder phases

// Risks
addRisk(); // Create new risk
removeRisk(id); // Delete risk
updateRisk(id, updates); // Edit risk
moveRisk(fromIdx, toIdx); // Reorder risks

// Stakeholders
addStakeholder(); // Create new stakeholder
removeStakeholder(id); // Delete stakeholder
updateStakeholder(id, updates); // Edit stakeholder

// Save
handleSave(); // Validate & save plan
```

---

## 📊 DATA STRUCTURES

### EditablePhase

```typescript
interface EditablePhase {
  id: string; // Unique ID
  name: string; // Phase name
  description: string; // Description
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  budget: number; // SEK
  resources: string[]; // [Geolog, Kemist, etc.]
}
```

### EditableRisk

```typescript
interface EditableRisk {
  id: string;
  name: string;
  description: string;
  category: string; // REGULATORY, ENVIRONMENTAL, etc.
  probability: 'LOW' | 'MEDIUM' | 'HIGH';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  mitigation: string; // Action plan
  owner: string; // Responsible person
}
```

### EditableStakeholder

```typescript
interface EditableStakeholder {
  id: string;
  name: string;
  role: string;
  interestLevel: 'LOW' | 'MEDIUM' | 'HIGH'; // Interest in project
  powerLevel: 'LOW' | 'MEDIUM' | 'HIGH'; // Influence/power
  communicationStrategy: string; // How to engage
}
```

### EditablePlan

```typescript
interface EditablePlan {
  phases: EditablePhase[];
  risks: EditableRisk[];
  stakeholders: EditableStakeholder[];
}
```

---

## 🎨 UI/UX FEATURES

### Tab System

```
┌─────────────────────────────────────────────┐
│ Faser (5)  | Risker (8)  | Intressenter (4) │
├─────────────────────────────────────────────┤
│                                             │
│  + Lägg till fas                            │
│                                             │
│  ☰ Fas 1: Undersökning        ✕           │
│     Beskrivning...                         │
│     Startdatum: 2026-04-15                 │
│     Slutdatum: 2026-06-15                  │
│     Budget: 150,000 SEK                    │
│                                             │
│  ☰ Fas 2: Provtagning         ✕           │
│     ...                                     │
│                                             │
└─────────────────────────────────────────────┘
Spara plan      Avbryt
```

### Item Card Features

```
☰ (Drag handle)
  ├─ Title (editable, bold)
  ├─ Description (textarea)
  ├─ Fields (input/select/date)
  └─ ✕ (Delete button)
```

### Drag-and-Drop

```
Användare kan:
1. Gripa i ☰-handtaget
2. Dra upp/ner
3. Släppa för att omordna
4. Omordningen sparas automatiskt i state
```

### Messages

```
ERROR:   ┌─────────────────────────────┐
         │ ⚠️ Failed to save plan    ✕ │
         └─────────────────────────────┘

SUCCESS: ┌─────────────────────────────┐
         │ ✅ Plan sparad framgångsrikt│
         └─────────────────────────────┘
```

---

## 📱 RESPONSIVE DESIGN

### Desktop (> 768px)

```
- Two-column layout where applicable
- Full drag-and-drop
- Inline editing
```

### Mobile (≤ 768px)

```
- Single column layout
- Stacked form fields
- Full-width buttons
- Touch-friendly handles
```

---

## 🔄 WORKFLOW: Generate → Edit → Save

### Step 1: Generate (ProjectPlanGenerator)

```
User fills form:
  - Fastighetsbeteckning: "Västra vägen 42"
  - Budget: 500,000
  - Description: "Sanering..."

User clicks "Generera Projektplan"

AI returns comprehensive plan:
  {
    phases: [...],
    risks: [...],
    stakeholders: [...]
  }
```

### Step 2: Edit (ProjectPlanEditor)

```
Plan is shown in interactive editor

User can:
  - Add new phases/risks/intressenter
  - Edit existing items
  - Delete unwanted items
  - Reorder items
  - See real-time changes

Plan is stored in component state (not saved yet)
```

### Step 3: Save

```
User clicks "Spara plan"

Frontend validates:
  - All required fields filled
  - Dates are valid
  - Budget > 0

Frontend sends to backend:
  POST /api/projects/:projectId/plan
  {
    plan: {...},
    generatedAt: "...",
    externalSourcesUsed: [...]
  }

Backend saves (Prisma, database)

Success message shown

Redirect to view saved plan
```

---

## 🔐 VALIDATION

### Client-side

```typescript
// Required fields
- Phase.name (non-empty)
- Risk.name (non-empty)
- Stakeholder.name (non-empty)

// Type validation
- Dates: YYYY-MM-DD format
- Budget: positive number
- Levels: LOW|MEDIUM|HIGH

// Business rules
- startDate ≤ endDate
- budget > 0
```

### Server-side

```typescript
// Same validation on backend
// Plus authorization check (requireAuth)
// Plus rate limiting
```

---

## 💾 PERSISTENCE

### Save Flow

```typescript
handleSave():
  1. setIsSaving(true)
  2. Call onSave(plan)
  3. Send POST to backend
  4. Wait for response
  5. If success: setSuccess(true)
  6. If error: setError(errorMsg)
  7. Reset after 2 sec
```

### Backend Endpoint

```http
POST /api/projects/:projectId/plan
Content-Type: application/json

{
  "plan": {
    "phases": [...],
    "risks": [...],
    "stakeholders": [...]
  },
  "generatedAt": "2026-04-02T14:00:00Z",
  "externalSourcesUsed": [...]
}

Response:
{
  "ok": true,
  "plan": {...full saved plan...}
}
```

---

## 🧪 TESTING

### Manual Testing

1. **Generate a plan**
   - Fill ProjectPlanGenerator form
   - Click "Generera Projektplan"
   - Should see editor with generated data

2. **Add items**
   - Click "+ Lägg till fas"
   - Should add new blank phase
   - Fill in details
   - Should see updates immediately

3. **Edit items**
   - Click on item title
   - Edit text
   - Changes reflected instantly

4. **Delete items**
   - Click ✕ button
   - Item removed from list
   - Count in tab updated

5. **Drag-and-drop**
   - Click & hold ☰ handle
   - Drag to new position
   - Release to drop
   - Should reorder

6. **Save**
   - Click "Spara plan"
   - Should show "Sparar..."
   - Wait for success message
   - Should redirect/reset

### Edge Cases

```
- Empty plan (0 phases) → Should allow save
- Very long descriptions → Should wrap correctly
- Large budgets → Should handle correctly
- Special characters in names → Should escape
- Rapid add/delete → Should maintain state
```

---

## 🔧 TROUBLESHOOTING

### Edits not saving

**Problem:** User makes changes but they don't stick

**Solution:**

1. Check browser console for errors
2. Verify network request in DevTools
3. Check server logs for 500 errors
4. Verify authorization token valid

### Drag-and-drop not working

**Problem:** Can't drag items to reorder

**Solution:**

1. Check browser supports drag API
2. Verify ☰ handle is visible
3. Try on desktop (mobile may have issues)
4. Clear browser cache

### Save fails with 400 error

**Problem:** "Plan must contain phases array"

**Solution:**

1. Ensure at least 1 phase exists
2. Check phases have all required fields
3. Verify data format matches schema
4. Check server logs for details

---

## 📚 RELATED FILES

```
Components:
  ├── ProjectPlanEditor.tsx          ← Main editor component
  ├── project-plan-editor.css        ← Styling
  ├── ProjectPlanGenerator.tsx        ← AI generator
  └── ProjectPlanGeneratorWithEditor.tsx ← Workflow wrapper

Routes:
  └── server/routes/admin.project-plan.ts  ← Save endpoint

Services:
  └── server/services/projectPlanGeneratorService.ts ← AI
```

---

## 🎓 KEY LEARNINGS

### Why Editor Needed?

1. **AI is not perfect** – Needs human oversight
2. **Business context matters** – Only users know project details
3. **Flexibility essential** – Plans change as projects evolve
4. **User empowerment** – Let users drive the process

### Design Decisions

1. **Tab-based layout** – Cleaner than scrolling
2. **Inline editing** – Faster than modal dialogs
3. **Drag-and-drop** – Intuitive reordering
4. **Real-time state** – No "apply changes" needed
5. **Save at end** – Single point of persistence

---

## 📞 SUMMARY

**ProjectPlanEditor** provides **complete flexibility** for users to:

✅ Build on AI suggestions
✅ Add missing components
✅ Remove unnecessary items
✅ Reorder by priority
✅ Save customized plan

**Result:** AI-assisted planning with human control.

**Status:** 🟢 PRODUCTION READY
