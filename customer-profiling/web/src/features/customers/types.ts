export interface SecondaryContact {
  name: string;
  contactNumber?: string;
  facebookAccount?: string;
  facebookProfileLink?: string;
  relationship?: string;
}

export interface Customer {
  id: string;
  accountNumber: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  contactNumber: string;
  alternateMobileNumber?: string;
  facebookAccountName?: string;
  facebookProfileLink?: string;
  secondaryContacts?: SecondaryContact[];
  secondaryContactName?: string;
  secondaryContactNumber?: string;
  secondaryContactFacebookAccount?: string;
  secondaryContactRelationship?: string;
  email?: string;
  addressLine1: string;
  addressLine2?: string;
  barangay: string;
  city: string;
  province: string;
  latitude?: string;
  longitude?: string;
  customerType: string;
  status?: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
}

export interface CustomerService {
  id: string;
  customerId: string;
  planId?: string;
  serviceId?: string;
  startDate: string;
  endDate?: string;
  status: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  moduleName: string;
  actorUserId: string;
  actorUsername?: string;
  actionType: string;
  entityType: string;
  entityId: string;
  correlationId?: string;
}
