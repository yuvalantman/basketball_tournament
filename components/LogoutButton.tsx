"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { useLocale } from "@/lib/i18n/LocaleContext";

export function LogoutButton() {
  const router = useRouter();
  const { t } = useLocale();
  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <Button variant="ghost" size="sm" onClick={logout}>
      {t("nav.logOut")}
    </Button>
  );
}
