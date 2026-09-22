import { useNavigate } from "react-router";
import { createPet } from "@/api/pets";
import { PetForm } from "@/components/PetForm";

/**
 * Add a pet.
 *
 * The animal is created under the caller — the server takes the owner from the
 * session, so there is nothing here to get wrong. Creating it also stamps
 * `ownedSince` to now, which is what makes sure a sitter booked before this
 * animal existed gets no access to it.
 */
export default function PetNewPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Add a pet</h1>
      <p className="mt-1 mb-8 text-sm text-charcoal/60">
        A sitter reads the feeding and behaviour notes before a walk, so the
        detail is worth it.
      </p>

      <PetForm
        submitLabel="Add pet"
        onCancel={() => navigate("/dashboard/pets")}
        onSubmit={async (input) => {
          const pet = await createPet(input);
          navigate(`/dashboard/pets/${pet.id}`, { replace: true });
        }}
      />
    </div>
  );
}
