import { Link } from "react-router";
import { AuthLayout } from "@/layouts/AuthLayout";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <AuthLayout>
      <LoginForm />
      <p className="mt-6 text-center text-[12px] text-muted-foreground">
        Нет компании в Nova?{" "}
        <Link to="/start" className="text-primary underline-offset-2 hover:underline">
          Подключить компанию
        </Link>
        {" · "}
        <Link to="/welcome" className="text-primary underline-offset-2 hover:underline">
          О продукте
        </Link>
      </p>
    </AuthLayout>
  );
}
