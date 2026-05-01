import { ReactNode, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, fetchJson } from '../common/http';
import { Customer } from './types';
import { toast } from '../../hooks/use-toast';

const ENRILE_CAGAYAN_BARANGAYS = [
  'Alibago',
  'Barangay I',
  'Barangay II',
  'Barangay III',
  'Barangay III-A',
  'Barangay IV',
  'Batu',
  'Divisoria',
  'Inga',
  'Lanna',
  'Lemu Norte',
  'Lemu Sur',
  'Liwan Norte',
  'Liwan Sur',
  'Maddarulug Norte',
  'Maddarulug Sur',
  'Magalalag East',
  'Magalalag West',
  'Marracuru',
  'Roma Norte',
  'Roma Sur',
  'San Antonio',
] as const;

const SANTA_MARIA_ISABELA_BARANGAYS = [
  'Bangad',
  'Buenavista',
  'Calamagui East',
  'Calamagui North',
  'Calamagui West',
  'Divisoria',
  'Lingaling',
  'Mozzozzin North',
  'Mozzozzin Sur',
  'Naganacan',
  'Poblacion 1',
  'Poblacion 2',
  'Poblacion 3',
  'Poblacion GK',
  'Poblacion Bliss',
  'Quinagabian',
  'San Antonio',
  'San Isidro East',
  'San Isidro West',
  'San Rafael East',
  'San Rafael West',
  'Villabuena',
] as const;

const CABAGAN_ISABELA_BARANGAYS = [
  'Aggub',
  'Annaronan',
  'Anao',
  'Angancasilian',
  'Balasig',
  'Catabayungan',
  'Centro',
  'Garita',
  'Luquilu',
  'Magleticia',
  'Masipi East',
  'Masipi West',
  'Ngarag',
  'San Antonio',
  'San Bernardo',
  'San Juan',
  'San Pablo',
  'Santa Maria',
  'Saranay',
  'Saui',
  'Tallag',
  'Ugad',
  'Union',
  'Villaflor',
  'Villahermosa',
  'Villa Imelda',
  'Villa Jesusa',
] as const;

const CAGAYAN_MUNICIPALITIES = [
  'Abulug',
  'Alcala',
  'Allacapan',
  'Amulung',
  'Aparri',
  'Baggao',
  'Ballesteros',
  'Buguey',
  'Calayan',
  'Camalaniugan',
  'Claveria',
  'Enrile',
  'Gattaran',
  'Gonzaga',
  'Iguig',
  'Lal-lo',
  'Lasam',
  'Pamplona',
  'Penablanca',
  'Piat',
  'Rizal',
  'Sanchez-Mira',
  'Santa Ana',
  'Santa Praxedes',
  'Santa Teresita',
  'Santo Nino',
  'Solana',
  'Tuao',
  'Tuguegarao City',
] as const;

const ISABELA_MUNICIPALITIES = [
  'Alicia',
  'Angadanan',
  'Aurora',
  'Benito Soliven',
  'Burgos',
  'Cabagan',
  'Cabatuan',
  'Cauayan City',
  'Cordon',
  'Dinapigue',
  'Divilacan',
  'Echague',
  'Gamu',
  'Ilagan City',
  'Jones',
  'Luna',
  'Maconacon',
  'Mallig',
  'Naguilian',
  'Palanan',
  'Quezon',
  'Quirino',
  'Ramon',
  'Reina Mercedes',
  'Roxas',
  'San Agustin',
  'San Guillermo',
  'San Isidro',
  'San Manuel',
  'San Mariano',
  'San Mateo',
  'San Pablo',
  'Santa Maria',
  'Santiago City',
  'Santo Tomas',
  'Tumauini',
] as const;

const customerSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  middleName: z.string().max(100).optional(),
  contactNumber: z
    .string()
    .min(1, 'Contact number is required')
    .regex(/^[+0-9]{7,20}$/, 'Contact number format is invalid'),
  alternateMobileNumber: z
    .string()
    .optional()
    .refine((value) => !value || /^[+0-9]{7,20}$/.test(value), {
      message: 'Alternate mobile number format is invalid',
    }),
  facebookAccountName: z.string().min(1, 'Facebook account name is required').max(150),
  facebookProfileLink: z.string().max(300).optional(),
  secondaryContacts: z.array(
    z.object({
      name: z.string().max(150).optional(),
      contactNumber: z
        .string()
        .optional()
        .refine((value) => !value || /^[+0-9]{7,20}$/.test(value), {
          message: 'Secondary contact number format is invalid',
        }),
      facebookAccount: z.string().max(150).optional(),
      facebookProfileLink: z.string().max(300).optional(),
      relationship: z.string().max(100).optional(),
    }),
  ),
  email: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || z.string().email().safeParse(value).success, {
      message: 'Email must be valid',
    }),
  addressLine1: z.string().min(1, 'Address Line 1 is required').max(200),
  addressLine2: z.string().max(200).optional(),
  barangay: z.string().min(1, 'Barangay is required').max(100),
  city: z.string().min(1, 'City is required').max(100),
  province: z.string().min(1, 'Province is required').max(100),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  customerType: z.enum(['RESIDENTIAL', 'BUSINESS', 'ENTERPRISE']),
});

type CustomerFormValues = z.infer<typeof customerSchema>;

const defaultValues: CustomerFormValues = {
  firstName: '',
  lastName: '',
  middleName: '',
  contactNumber: '',
  alternateMobileNumber: '',
  facebookAccountName: '',
  facebookProfileLink: '',
  secondaryContacts: [
    { name: '', contactNumber: '', facebookAccount: '', facebookProfileLink: '', relationship: '' },
  ],
  email: '',
  addressLine1: '',
  addressLine2: '',
  barangay: '',
  city: 'Enrile',
  province: 'Cagayan',
  latitude: '',
  longitude: '',
  customerType: 'RESIDENTIAL',
};

function toUpperTrim(value?: string) {
  return value?.trim().toUpperCase();
}

function toCanonicalCase(value: string | undefined, options: readonly string[]) {
  if (!value) {
    return '';
  }
  const upper = value.toUpperCase();
  const found = options.find((option) => option.toUpperCase() === upper);
  return found || value;
}

export default function CustomerFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues,
  });
  const secondaryContactsFieldArray = useFieldArray({
    control,
    name: 'secondaryContacts',
  });
  const province = watch('province');
  const municipality = watch('city');

  const details = useQuery({
    queryKey: ['customer', id],
    enabled: isEdit,
    queryFn: () => fetchJson<Customer>(`${api.customers}/${id}`),
  });

  useEffect(() => {
    if (details.data) {
      const provinceValue = toCanonicalCase(details.data.province, ['Cagayan', 'Isabela']);
      const municipalityOptions =
        provinceValue === 'Cagayan' ? CAGAYAN_MUNICIPALITIES : ISABELA_MUNICIPALITIES;
      const cityValue = toCanonicalCase(details.data.city, municipalityOptions);

      let barangayValue = details.data.barangay;
      if (provinceValue === 'Cagayan' && cityValue === 'Enrile') {
        barangayValue = toCanonicalCase(details.data.barangay, ENRILE_CAGAYAN_BARANGAYS);
      }
      if (provinceValue === 'Isabela' && cityValue === 'Santa Maria') {
        barangayValue = toCanonicalCase(details.data.barangay, SANTA_MARIA_ISABELA_BARANGAYS);
      }
      if (provinceValue === 'Isabela' && cityValue === 'Cabagan') {
        barangayValue = toCanonicalCase(details.data.barangay, CABAGAN_ISABELA_BARANGAYS);
      }

      reset({
        firstName: details.data.firstName,
        lastName: details.data.lastName,
        middleName: details.data.middleName || '',
        contactNumber: details.data.contactNumber,
        alternateMobileNumber: details.data.alternateMobileNumber || '',
        facebookAccountName: details.data.facebookAccountName || '',
        facebookProfileLink: details.data.facebookProfileLink || '',
        secondaryContacts:
          details.data.secondaryContacts && details.data.secondaryContacts.length > 0
            ? details.data.secondaryContacts.map((item) => ({
                name: item.name || '',
                contactNumber: item.contactNumber || '',
                facebookAccount: item.facebookAccount || '',
                facebookProfileLink: item.facebookProfileLink || '',
                relationship: item.relationship || '',
              }))
            : details.data.secondaryContactName
              ? [
                  {
                    name: details.data.secondaryContactName || '',
                    contactNumber: details.data.secondaryContactNumber || '',
                    facebookAccount: details.data.secondaryContactFacebookAccount || '',
                    facebookProfileLink: '',
                    relationship: details.data.secondaryContactRelationship || '',
                  },
                ]
              : [
                  {
                    name: '',
                    contactNumber: '',
                    facebookAccount: '',
                    facebookProfileLink: '',
                    relationship: '',
                  },
                ],
        email: details.data.email || '',
        addressLine1: details.data.addressLine1,
        addressLine2: details.data.addressLine2 || '',
        barangay: barangayValue,
        city: cityValue,
        province: provinceValue,
        latitude: details.data.latitude || '',
        longitude: details.data.longitude || '',
        customerType: details.data.customerType as CustomerFormValues['customerType'],
      });
    }
  }, [details.data, reset]);

  useEffect(() => {
    if (province === 'Cagayan' && !CAGAYAN_MUNICIPALITIES.includes(getValues('city') as never)) {
      setValue('city', 'Enrile', { shouldValidate: true });
    }
    if (province === 'Isabela' && !ISABELA_MUNICIPALITIES.includes(getValues('city') as never)) {
      setValue('city', 'Santa Maria', { shouldValidate: true });
    }
  }, [province, getValues, setValue]);

  useEffect(() => {
    const barangay = getValues('barangay');
    if (
      province === 'Cagayan' &&
      municipality === 'Enrile' &&
      barangay &&
      !ENRILE_CAGAYAN_BARANGAYS.includes(barangay as (typeof ENRILE_CAGAYAN_BARANGAYS)[number])
    ) {
      setValue('barangay', '', { shouldValidate: true });
    }
    if (
      province === 'Isabela' &&
      municipality === 'Santa Maria' &&
      barangay &&
      !SANTA_MARIA_ISABELA_BARANGAYS.includes(
        barangay as (typeof SANTA_MARIA_ISABELA_BARANGAYS)[number],
      )
    ) {
      setValue('barangay', '', { shouldValidate: true });
    }
    if (
      province === 'Isabela' &&
      municipality === 'Cabagan' &&
      barangay &&
      !CABAGAN_ISABELA_BARANGAYS.includes(barangay as (typeof CABAGAN_ISABELA_BARANGAYS)[number])
    ) {
      setValue('barangay', '', { shouldValidate: true });
    }
  }, [province, municipality, getValues, setValue]);

  const mutation = useMutation({
    mutationFn: async (values: CustomerFormValues) => {
      const payload = {
        firstName: toUpperTrim(values.firstName) || '',
        lastName: toUpperTrim(values.lastName) || '',
        middleName: toUpperTrim(values.middleName) || undefined,
        contactNumber: toUpperTrim(values.contactNumber) || '',
        alternateMobileNumber: toUpperTrim(values.alternateMobileNumber) || undefined,
        facebookAccountName: toUpperTrim(values.facebookAccountName) || '',
        facebookProfileLink: values.facebookProfileLink?.trim() || undefined,
        secondaryContacts: values.secondaryContacts
          .map((item) => ({
            name: toUpperTrim(item.name) || '',
            contactNumber: toUpperTrim(item.contactNumber) || undefined,
            facebookAccount: toUpperTrim(item.facebookAccount) || undefined,
            facebookProfileLink: item.facebookProfileLink?.trim() || undefined,
            relationship: toUpperTrim(item.relationship) || undefined,
          }))
          .filter((item) => item.name.length > 0),
        email: toUpperTrim(values.email) || undefined,
        addressLine1: toUpperTrim(values.addressLine1) || '',
        addressLine2: toUpperTrim(values.addressLine2) || undefined,
        barangay: toUpperTrim(values.barangay) || '',
        city: toUpperTrim(values.city) || '',
        province: toUpperTrim(values.province) || '',
        latitude: toUpperTrim(values.latitude) || undefined,
        longitude: toUpperTrim(values.longitude) || undefined,
        customerType: values.customerType,
      };

      if (isEdit) {
        return fetchJson(`${api.customers}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      return fetchJson(api.customers, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast({
        title: isEdit ? 'Customer updated' : 'Customer created',
        description: isEdit
          ? 'Customer details have been saved successfully.'
          : 'Customer profile was created successfully.',
        variant: 'success',
      });
      navigate('/customers');
    },
    onError: (error: Error) => {
      toast({
        title: 'Unable to save customer',
        description: error.message,
        variant: 'destructive',
      });
      setError('root', { message: error.message });
    },
  });

  const onSubmit = async (values: CustomerFormValues) => {
    await mutation.mutateAsync(values);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{isEdit ? 'Edit Customer' : 'Create Customer'}</h1>
        <Link className="text-blue-600" to="/customers">
          Back to customers
        </Link>
      </div>

      <form
        className="w-full space-y-10 [&_input]:uppercase [&_select]:uppercase"
        onSubmit={handleSubmit(onSubmit)}
      >
        <Section title="Customer Identity">
          <div className="grid gap-6 lg:grid-cols-3">
            <Field label="Account Number">
              <input
                className="w-full rounded border px-3 py-2"
                value={isEdit ? details.data?.accountNumber || '' : 'AUTO-GENERATED ON SAVE'}
                disabled
                readOnly
              />
            </Field>

            <Field label="Customer Type" error={errors.customerType?.message} required>
              <select className="w-full rounded border px-3 py-2" {...register('customerType')}>
                <option value="RESIDENTIAL">RESIDENTIAL</option>
                <option value="BUSINESS">BUSINESS</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            </Field>

            <Field label="First Name" error={errors.firstName?.message} required className="lg:col-start-1">
              <input className="w-full rounded border px-3 py-2" {...register('firstName')} />
            </Field>

            <Field label="Middle Name" error={errors.middleName?.message}>
              <input className="w-full rounded border px-3 py-2" {...register('middleName')} />
            </Field>

            <Field label="Last Name" error={errors.lastName?.message} required>
              <input className="w-full rounded border px-3 py-2" {...register('lastName')} />
            </Field>
          </div>
        </Section>

        <Section title="Primary Contact">
          <div className="grid gap-6 lg:grid-cols-3">
            <Field label="Contact Number" error={errors.contactNumber?.message} required>
              <input className="w-full rounded border px-3 py-2" {...register('contactNumber')} />
            </Field>

            <Field label="Alternate Mobile Number" error={errors.alternateMobileNumber?.message}>
              <input
                className="w-full rounded border px-3 py-2"
                {...register('alternateMobileNumber')}
              />
            </Field>

            <Field label="Email" error={errors.email?.message}>
              <input className="w-full rounded border px-3 py-2" {...register('email')} />
            </Field>

            <Field
              label="Facebook Account Name"
              error={errors.facebookAccountName?.message}
              required
            >
              <input className="w-full rounded border px-3 py-2" {...register('facebookAccountName')} />
            </Field>

            <Field
              label="Facebook Profile Link"
              error={errors.facebookProfileLink?.message}
              className="lg:col-span-2"
            >
              <input className="w-full rounded border px-3 py-2 normal-case" {...register('facebookProfileLink')} />
            </Field>
          </div>
        </Section>

        <Section title="Address Information">
          <div className="grid gap-6 lg:grid-cols-3">
            <Field
              label="Address Line 1"
              error={errors.addressLine1?.message}
              className="lg:col-span-3"
              required
            >
              <input className="w-full rounded border px-3 py-2" {...register('addressLine1')} />
            </Field>

            <Field label="Address Line 2" error={errors.addressLine2?.message} className="lg:col-span-3">
              <input className="w-full rounded border px-3 py-2" {...register('addressLine2')} />
            </Field>

            <Field label="Province" error={errors.province?.message} required>
              <select className="w-full rounded border px-3 py-2" {...register('province')}>
                <option value="Cagayan">Cagayan</option>
                <option value="Isabela">Isabela</option>
              </select>
            </Field>

            <Field label="Municipality" error={errors.city?.message} required>
              {province === 'Cagayan' ? (
                <select className="w-full rounded border px-3 py-2" {...register('city')}>
                  {CAGAYAN_MUNICIPALITIES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : province === 'Isabela' ? (
                <select className="w-full rounded border px-3 py-2" {...register('city')}>
                  <option value="">Select municipality</option>
                  {ISABELA_MUNICIPALITIES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="w-full rounded border px-3 py-2" {...register('city')} />
              )}
            </Field>

            <Field label="Barangay" error={errors.barangay?.message} required>
              {province === 'Cagayan' && municipality === 'Enrile' ? (
                <select className="w-full rounded border px-3 py-2" {...register('barangay')}>
                  <option value="">Select barangay</option>
                  {ENRILE_CAGAYAN_BARANGAYS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : province === 'Isabela' && municipality === 'Santa Maria' ? (
                <select className="w-full rounded border px-3 py-2" {...register('barangay')}>
                  <option value="">Select barangay</option>
                  {SANTA_MARIA_ISABELA_BARANGAYS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : province === 'Isabela' && municipality === 'Cabagan' ? (
                <select className="w-full rounded border px-3 py-2" {...register('barangay')}>
                  <option value="">Select barangay</option>
                  {CABAGAN_ISABELA_BARANGAYS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="w-full rounded border px-3 py-2" {...register('barangay')} />
              )}
            </Field>

            <Field label="Latitude" error={errors.latitude?.message}>
              <input className="w-full rounded border px-3 py-2" {...register('latitude')} />
            </Field>

            <Field label="Longitude" error={errors.longitude?.message}>
              <input className="w-full rounded border px-3 py-2" {...register('longitude')} />
            </Field>
          </div>
        </Section>

        <Section
          title="Secondary Contacts"
        >
          <div className="space-y-4">
            {secondaryContactsFieldArray.fields.map((field, index) => (
              <div className="space-y-4 rounded border border-gray-200 p-4" key={field.id}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Contact {index + 1}</h3>
                  {secondaryContactsFieldArray.fields.length > 1 && (
                    <button
                      className="text-sm font-medium text-red-600"
                      onClick={() => secondaryContactsFieldArray.remove(index)}
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid gap-6 lg:grid-cols-3">
                  <Field
                    label="Secondary Contact Name"
                    error={errors.secondaryContacts?.[index]?.name?.message}
                  >
                    <input
                      className="w-full rounded border px-3 py-2"
                      {...register(`secondaryContacts.${index}.name` as const)}
                    />
                  </Field>

                  <Field
                    label="Secondary Contact Number"
                    error={errors.secondaryContacts?.[index]?.contactNumber?.message}
                  >
                    <input
                      className="w-full rounded border px-3 py-2"
                      {...register(`secondaryContacts.${index}.contactNumber` as const)}
                    />
                  </Field>

                  <Field
                    label="Relationship to Customer"
                    error={errors.secondaryContacts?.[index]?.relationship?.message}
                  >
                    <input
                      className="w-full rounded border px-3 py-2"
                      {...register(`secondaryContacts.${index}.relationship` as const)}
                    />
                  </Field>

                  <Field
                    label="Secondary Contact Facebook Account"
                    error={errors.secondaryContacts?.[index]?.facebookAccount?.message}
                    className="lg:col-span-2"
                  >
                    <input
                      className="w-full rounded border px-3 py-2"
                      {...register(`secondaryContacts.${index}.facebookAccount` as const)}
                    />
                  </Field>

                  <Field
                    label="Secondary Contact Facebook Profile Link (Optional)"
                    error={errors.secondaryContacts?.[index]?.facebookProfileLink?.message}
                    className="lg:col-span-1"
                  >
                    <input
                      className="w-full rounded border px-3 py-2 normal-case"
                      {...register(`secondaryContacts.${index}.facebookProfileLink` as const)}
                    />
                  </Field>
                </div>
              </div>
            ))}
            <button
              className="rounded border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700"
              onClick={() =>
                secondaryContactsFieldArray.append({
                  name: '',
                  contactNumber: '',
                  facebookAccount: '',
                  facebookProfileLink: '',
                  relationship: '',
                })
              }
              type="button"
            >
              Add Secondary Contact
            </button>
          </div>
        </Section>

        {errors.root?.message && <div className="text-sm text-red-600">{errors.root.message}</div>}

        <button
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-70"
          disabled={isSubmitting || mutation.isPending}
          type="submit"
        >
          {isSubmitting || mutation.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Customer'}
        </button>
      </form>
    </div>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}

function Field({ label, error, children, className, required }: FieldProps) {
  return (
    <label className={`space-y-2 ${className ?? ''}`}>
      <span className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </span>
      {children}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="space-y-5 rounded-md border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-lg font-bold tracking-wide text-slate-800">{title}</h2>
      </div>
      {children}
    </section>
  );
}
