import { Suspense } from "react";
import { SignupForm } from "@/components/screens/SignupForm";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
