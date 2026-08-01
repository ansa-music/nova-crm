export interface AppUser {
  uid: string;
  email: string;
  name: string;
  photoURL?: string | null;
  createdAt: number;
}
