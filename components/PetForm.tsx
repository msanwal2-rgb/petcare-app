"use client";

/* watch() is React Hook Form's intended subscription API for reactive fields. */
/* eslint-disable react-hooks/incompatible-library */

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import type { Pet, Species } from "@/types";
import { createPet, updatePet, type PetInput } from "@/lib/api/pets";
import { Field, Input, Textarea, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import {
  DOG_PHOTOS,
  CAT_PHOTOS,
  OTHER_PHOTOS,
  unsplash,
  BLUR_DATA_URL,
} from "@/lib/mock-data/photos";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().min(1, "What’s your pet’s name?"),
  species: z.enum(["dog", "cat", "other"]),
  breed: z.string().min(1, "Add a breed (or “Mixed”)."),
  sex: z.enum(["male", "female"]),
  dob: z.string().min(1, "Add a date of birth."),
  weightLbs: z.coerce.number().positive("Weight must be greater than 0."),
  photoUrl: z.string().min(1, "Pick a photo."),
  vaccinated: z.boolean(),
  allergies: z.string(),
  medications: z.string(),
  behaviorNotes: z.string(),
  feedingInstructions: z.string(),
  vetName: z.string().min(1, "Add your vet’s name."),
  vetPhone: z.string().min(1, "Add your vet’s phone."),
});

type FormValues = z.input<typeof schema>;

const PHOTOS: Record<Species, string[]> = {
  dog: DOG_PHOTOS,
  cat: CAT_PHOTOS,
  other: OTHER_PHOTOS,
};

export function PetForm({
  ownerId,
  pet,
}: {
  ownerId: string;
  pet?: Pet;
}) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: pet
      ? {
          name: pet.name,
          species: pet.species,
          breed: pet.breed,
          sex: pet.sex,
          dob: pet.dob,
          weightLbs: pet.weightLbs,
          photoUrl: pet.photoUrl,
          vaccinated: pet.vaccinated,
          allergies: pet.allergies.join(", "),
          medications: pet.medications.join(", "),
          behaviorNotes: pet.behaviorNotes,
          feedingInstructions: pet.feedingInstructions,
          vetName: pet.vetContact.name,
          vetPhone: pet.vetContact.phone,
        }
      : {
          name: "",
          species: "dog",
          breed: "",
          sex: "male",
          dob: "",
          weightLbs: 20,
          photoUrl: unsplash(DOG_PHOTOS[0], 900, 700),
          vaccinated: true,
          allergies: "",
          medications: "",
          behaviorNotes: "",
          feedingInstructions: "",
          vetName: "",
          vetPhone: "",
        },
  });

  const species = watch("species");
  const photoUrl = watch("photoUrl");

  async function onSubmit(values: FormValues) {
    const toList = (s: string) =>
      s.split(",").map((x) => x.trim()).filter(Boolean);
    const payload: PetInput = {
      ownerId,
      name: values.name,
      species: values.species,
      breed: values.breed,
      sex: values.sex,
      dob: values.dob,
      weightLbs: Number(values.weightLbs),
      photoUrl: values.photoUrl,
      vaccinated: values.vaccinated,
      allergies: toList(values.allergies),
      medications: toList(values.medications),
      behaviorNotes: values.behaviorNotes,
      feedingInstructions: values.feedingInstructions,
      vetContact: { name: values.vetName, phone: values.vetPhone },
    };

    try {
      if (pet) {
        await updatePet(pet.id, payload);
        toast.success(`${values.name}’s profile updated.`);
      } else {
        await createPet(payload);
        toast.success(`${values.name} added to your pets.`);
      }
      router.push("/dashboard");
    } catch {
      toast.error("Couldn’t save. Please try again.");
    }
  }

  const gallery = PHOTOS[species] ?? DOG_PHOTOS;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Photo picker */}
      <div>
        <p className="mb-2 text-sm font-medium text-ink">Photo</p>
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-mist">
            {photoUrl && (
              <Image
                src={photoUrl}
                alt=""
                fill
                sizes="96px"
                placeholder="blur"
                blurDataURL={BLUR_DATA_URL}
                className="object-cover"
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {gallery.slice(0, 6).map((id) => {
              const url = unsplash(id, 900, 700);
              const active = url === photoUrl;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setValue("photoUrl", url, { shouldValidate: true })}
                  className={cn(
                    "relative h-12 w-12 overflow-hidden rounded-lg border-2 transition-colors",
                    active ? "border-leash" : "border-transparent hover:border-mist"
                  )}
                >
                  <Image
                    src={unsplash(id, 120, 120)}
                    alt=""
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                </button>
              );
            })}
          </div>
        </div>
        {errors.photoUrl && (
          <p className="mt-1.5 text-xs text-leash">{errors.photoUrl.message}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" {...register("name")} placeholder="e.g. Biscuit" />
        </Field>
        <Field label="Breed" htmlFor="breed" error={errors.breed?.message}>
          <Input id="breed" {...register("breed")} placeholder="e.g. Golden Retriever" />
        </Field>
        <Field label="Species" htmlFor="species">
          <Select id="species" {...register("species")}>
            <option value="dog">Dog</option>
            <option value="cat">Cat</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Sex" htmlFor="sex">
          <Select id="sex" {...register("sex")}>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </Select>
        </Field>
        <Field label="Date of birth" htmlFor="dob" error={errors.dob?.message}>
          <Input id="dob" type="date" {...register("dob")} />
        </Field>
        <Field label="Weight (lbs)" htmlFor="weight" error={errors.weightLbs?.message}>
          <Input id="weight" type="number" step="0.1" {...register("weightLbs")} />
        </Field>
      </div>

      <label className="flex items-center gap-2.5 rounded-xl border border-mist bg-white px-4 py-3">
        <input
          type="checkbox"
          {...register("vaccinated")}
          className="h-4 w-4 accent-ink"
        />
        <span className="text-sm text-charcoal">Vaccinations are up to date</span>
      </label>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          label="Allergies"
          htmlFor="allergies"
          hint="Comma-separated"
        >
          <Input id="allergies" {...register("allergies")} placeholder="e.g. Chicken, grass" />
        </Field>
        <Field
          label="Medications"
          htmlFor="medications"
          hint="Comma-separated"
        >
          <Input
            id="medications"
            {...register("medications")}
            placeholder="e.g. Apoquel 5.4mg, 1× daily"
          />
        </Field>
      </div>

      <Field label="Behavior notes" htmlFor="behavior">
        <Textarea
          id="behavior"
          {...register("behaviorNotes")}
          placeholder="Temperament, triggers, how they are with other animals…"
        />
      </Field>

      <Field label="Feeding instructions" htmlFor="feeding">
        <Textarea
          id="feeding"
          {...register("feedingInstructions")}
          placeholder="Food type, quantity, schedule…"
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Vet name / clinic" htmlFor="vetName" error={errors.vetName?.message}>
          <Input id="vetName" {...register("vetName")} placeholder="e.g. South Austin Animal Hospital" />
        </Field>
        <Field label="Vet phone" htmlFor="vetPhone" error={errors.vetPhone?.message}>
          <Input id="vetPhone" {...register("vetPhone")} placeholder="(512) 555-0100" />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-mist pt-6">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/dashboard")}
        >
          Cancel
        </Button>
        <Button type="submit" variant="cta" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : pet ? "Save changes" : "Add pet"}
        </Button>
      </div>
    </form>
  );
}
