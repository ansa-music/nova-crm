import { create } from "zustand";
import type { User } from "firebase/auth";
import type { AppUser } from "@/types";

interface AuthState {
  firebaseUser: User | null;
  profile: AppUser | null;
  isLoading: boolean;
  setFirebaseUser: (user: User | null) => void;
  setProfile: (profile: AppUser | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  firebaseUser: null,
  profile: null,
  isLoading: true,
  setFirebaseUser: (firebaseUser) => set({ firebaseUser }),
  setProfile: (profile) => set({ profile }),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => set({ firebaseUser: null, profile: null, isLoading: false }),
}));
