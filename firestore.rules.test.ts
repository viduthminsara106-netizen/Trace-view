/**
 * Firestore Security Rules Test Suite — Verifies all "Dirty Dozen" payloads return PERMISSION_DENIED.
 */

export interface TestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const dirtyDozenTests: TestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Write',
    operation: 'create',
    path: '/activities/act_01',
    auth: null,
    payload: { userId: 'user_1', title: 'YouTube' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Spoof',
    operation: 'create',
    path: '/activities/act_01',
    auth: { uid: 'user_1', email_verified: false },
    payload: { userId: 'user_1', title: 'YouTube' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-User Identity Spoofing on Create',
    operation: 'create',
    path: '/activities/act_01',
    auth: { uid: 'user_1', email_verified: true },
    payload: { userId: 'user_2', title: 'YouTube' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow / Ghost Field Injection on Create',
    operation: 'create',
    path: '/activities/act_01',
    auth: { uid: 'user_1', email_verified: true },
    payload: { userId: 'user_1', title: 'YouTube', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'ID Poisoning Attack',
    operation: 'create',
    path: '/activities/bad$id!@#',
    auth: { uid: 'user_1', email_verified: true },
    payload: { userId: 'user_1', title: 'YouTube' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Denial-of-Wallet Oversized String',
    operation: 'create',
    path: '/activities/act_01',
    auth: { uid: 'user_1', email_verified: true },
    payload: { userId: 'user_1', title: 'A'.repeat(500) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Invalid Enum Injection',
    operation: 'create',
    path: '/activities/act_01',
    auth: { uid: 'user_1', email_verified: true },
    payload: { userId: 'user_1', category: 'invalid_cat' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Negative or Overflow Numeric Values',
    operation: 'create',
    path: '/activities/act_01',
    auth: { uid: 'user_1', email_verified: true },
    payload: { userId: 'user_1', visitCount: -10 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Spoofed Client Timestamp on Create',
    operation: 'create',
    path: '/activities/act_01',
    auth: { uid: 'user_1', email_verified: true },
    payload: { userId: 'user_1', createdAt: '1999-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immutable Field Mutation on Update',
    operation: 'update',
    path: '/activities/act_01',
    auth: { uid: 'user_1', email_verified: true },
    payload: { userId: 'user_2' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unauthorized Field Mutation on Update',
    operation: 'update',
    path: '/activities/act_01',
    auth: { uid: 'user_1', email_verified: true },
    payload: { url: 'https://malicious.example.com' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket List Query Scraping Across Users',
    operation: 'list',
    path: '/activities',
    auth: { uid: 'user_attacker', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
];
