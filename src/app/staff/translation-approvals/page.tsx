import { redirect } from "next/navigation";

/** Staff routes are tenant-scoped; send operators to business selection. */
export default function StaffTranslationApprovalsRedirectPage() {
  redirect("/staff/businesses");
}
