// Deserializes Firestore REST API typed values into plain JS values

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { referenceValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export function deserialize(value: FirestoreValue | undefined | null): unknown {
  if (value == null) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return parseInt(value.integerValue, 10);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('referenceValue' in value) {
    // Extract the document ID from the full resource path
    const parts = value.referenceValue.split('/');
    return parts[parts.length - 1];
  }
  if ('arrayValue' in value) {
    return (value.arrayValue.values ?? []).map(deserialize);
  }
  if ('mapValue' in value) {
    return deserializeFields(value.mapValue.fields ?? {});
  }
  return null;
}

export function deserializeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, deserialize(v)])
  );
}

export interface Guest {
  id: string;       // Firestore document ID
  userId: string;   // Partiful user ID (from referenceValue)
  name: string;
  status: 'GOING' | 'NOT_GOING' | 'MAYBE' | string;
  count: number;    // 1 = just them, >1 includes plus-ones
  rsvpDate: Date;
  rsvpOrigin: string;
  timezone: string;
}

export function deserializeGuest(doc: any): Guest {
  const f = doc.document.fields;
  const pathParts = (doc.document.name as string).split('/');
  return {
    id: pathParts[pathParts.length - 1],
    userId: deserialize(f.user) as string,
    name: deserialize(f.name) as string,
    status: deserialize(f.status) as string,
    count: deserialize(f.count) as number,
    rsvpDate: deserialize(f.rsvpDate) as Date,
    rsvpOrigin: deserialize(f.rsvpOrigin) as string,
    timezone: deserialize(f.timezone) as string,
  };
}
