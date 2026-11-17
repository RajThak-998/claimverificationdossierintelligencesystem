#!/usr/bin/env python3
"""
Generates authentic demo insurance investigation PDFs and screenshot images
for Case MOT18221241 (Tata Prima 4028.S Heavy Commercial Vehicle).
"""
import os
import struct
import zlib

def create_pdf(filepath, title, subtitle, header_color, sections):
    """
    Creates a clean, valid PDF 1.4 document with formatted sections and metadata.
    """
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    stream_lines = [
        'BT',
        '/F1 16 Tf',
        f'50 780 Td',
        f'({title}) Tj',
        'ET',
        'BT',
        '/F2 10 Tf',
        f'50 762 Td',
        f'({subtitle}) Tj',
        'ET',
        # Draw a horizontal rule
        '0.2 0.3 0.4 rg',
        '50 750 495 2 re f',
    ]

    y = 730
    for heading, lines in sections:
        # Section Heading
        stream_lines.extend([
            'BT',
            '/F1 12 Tf',
            f'1 0 0 1 50 {y} Tm',
            f'({heading}) Tj',
            'ET',
            '0.85 0.9 0.95 rg',
            f'50 {y-3} 495 1 re f',
        ])
        y -= 20
        # Section Content
        for line in lines:
            safe = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            stream_lines.extend([
                'BT',
                '/F2 9 Tf',
                f'1 0 0 1 55 {y} Tm',
                f'({safe}) Tj',
                'ET',
            ])
            y -= 14
        y -= 10

    # Footer
    stream_lines.extend([
        '0.4 0.4 0.4 rg',
        '50 45 495 0.5 re f',
        'BT',
        '/F2 8 Tf',
        '50 32 Td',
        '(Government of Maharashtra / Motor Third Party Claims Tribunal - Evidence Annexure) Tj',
        'ET',
    ])

    stream_data = '\n'.join(stream_lines).encode('latin-1')
    stream_len = len(stream_data)

    body = f'''%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
6 0 obj
<< /Length {stream_len} >>
stream
'''.encode('latin-1') + stream_data + b'''
endstream
endobj
'''

    offsets = [0]
    for i in range(1, 7):
        pos = body.find(f'{i} 0 obj'.encode('latin-1'))
        offsets.append(pos)

    xref = f'''xref
0 7
0000000000 65535 f \n'''
    for off in offsets[1:]:
        xref += f'{off:010d} 00000 n \n'
    trailer = f'''trailer
<< /Size 7 /Root 1 0 R >>
startxref
{len(body)}
%%EOF'''

    with open(filepath, 'wb') as f:
        f.write(body + xref.encode('latin-1') + trailer.encode('latin-1'))
    print(f"Generated PDF: {filepath}")


def create_mock_png(filepath, width, height, color_rgb, label_text):
    """
    Creates a simple valid PNG file without PIL.
    """
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    raw_data = bytearray()
    r, g, b = color_rgb
    for _ in range(height):
        raw_data.append(0) # filter byte 0 (None)
        for _ in range(width):
            raw_data.extend([r, g, b])
    
    compressed = zlib.compress(bytes(raw_data))
    
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png_bytes = b'\x89PNG\r\n\x1a\n'
    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    png_bytes += chunk(b'IHDR', ihdr_data)
    # IDAT
    png_bytes += chunk(b'IDAT', compressed)
    # IEND
    png_bytes += chunk(b'IEND', b'')

    with open(filepath, 'wb') as f:
        f.write(png_bytes)
    print(f"Generated PNG: {filepath}")


def main():
    base_dirs = [
        "backend/data/storage/cases/case-hgv-101",
        "data/storage/cases/case-hgv-101",
    ]

    for base in base_dirs:
        docs_dir = os.path.join(base, "documents")
        shots_dir = os.path.join(base, "screenshots")

        # 1. Registration Certificate (RC)
        create_pdf(
            os.path.join(docs_dir, "MH12AB1234_Registration_Certificate.pdf"),
            "FORM 23 - CERTIFICATE OF REGISTRATION",
            "Transport Department, Government of Maharashtra | RTO Pune (MH-12)",
            (10, 50, 120),
            [
                ("1. Vehicle Identification & Ownership", [
                    "Registration Number: MH-12-AB-1234           Registration Date: 14-Aug-2022",
                    "Owner Name: RAMESH KUMAR TRANSPORTS           Ownership Type: Individual / Proprietary",
                    "Son / Daughter / Wife of: Late Mohanlal Kumar",
                    "Permanent Address: Plot 42, Transport Nagar, Nigdi, Pune, Maharashtra - 411044",
                    "Current Status: ACTIVE (Hypothecated to HDFC Bank Commercial Fleet Division)",
                ]),
                ("2. Technical Specifications (Heavy Commercial)", [
                    "Vehicle Class: Heavy Goods Vehicle (HGV) - Multi-Axle Goods Carrier",
                    "Maker Name: TATA MOTORS LTD                 Commercial Model: TATA PRIMA 4028.S (14-Wheeler)",
                    "Chassis Number: MAT448021N7M12345           Engine Number: CUMMINS-ISBe270-40981",
                    "Gross Vehicle Weight (GVW): 40,000 kg        Unladen Weight: 11,200 kg",
                    "Number of Cylinders: 6 (Diesel BS-VI)        Horse Power: 267.00 BHP",
                    "Wheelbase: 3,900 mm                         Seating Capacity: 2 (1 Driver + 1 Helper)",
                ]),
                ("3. Taxation, Fitness & Permit Endorsements", [
                    "Fitness Certificate No: MH12/FC/2022/99042   Fitness Valid Upto: 15-Sep-2027",
                    "Motor Vehicle Tax Paid Upto: 31-Dec-2026     PUC Certificate: VALID (Exp: 14-Oct-2027)",
                    "Insurance Policy Linked: ICICI Lombard GIC - Policy #POL-ICICI-99210-A",
                ]),
            ]
        )

        # 2. Driving License (DL)
        create_pdf(
            os.path.join(docs_dir, "Sunil_Shinde_Commercial_Driving_License.pdf"),
            "FORM 7 - DRIVING LICENCE SMART CARD RECORD",
            "Licensing Authority: RTO Pimpri-Chinchwad (MH-14), Maharashtra",
            (15, 80, 50),
            [
                ("1. Licensee Particulars", [
                    "Licence Number: MH-14-20150089123           Original Issue Date: 18-Feb-2015",
                    "Full Name: SUNIL BABAN SHINDE               Date of Birth: 12-Jun-1988 (Age 38)",
                    "Father's Name: Baban Tukaram Shinde         Blood Group: B+ve",
                    "Address: H.No 108, Gavthan Road, Talegaon Dabhade, Maval, Pune - 410506",
                ]),
                ("2. Class of Vehicles Authorized to Drive", [
                    "Class: LMV (Light Motor Vehicle - Non Transport)     Valid From: 18-Feb-2015 Upto: 11-Jun-2048",
                    "Class: TRANS / HGV (Heavy Goods Commercial Vehicle)  Valid From: 15-Aug-2018 Upto: 14-Aug-2027",
                    "Class: HAZCHEM (Hazardous Goods Transport Badge)     Valid From: 10-Jan-2024 Upto: 09-Jan-2027",
                ]),
                ("3. Badges & Endorsements", [
                    "Commercial Transport Badge No: B-992144 / MH-14 (ACTIVE)",
                    "Disqualification / Suspension History: NIL (Clean Driving Record)",
                    "Special Endorsement: Valid to drive multi-axle heavy articulated cargo trucks interstate.",
                ]),
            ]
        )

        # 3. Police Station General Diary (FIR / GD Memo)
        create_pdf(
            os.path.join(docs_dir, "Talegaon_Police_Station_GD_Memo.pdf"),
            "STATION GENERAL DIARY EXTRACT - ROAD TRAFFIC COLLISION",
            "Talegaon Dabhade Police Station | Pune Rural District | GD Entry No. 142/2026",
            (120, 20, 20),
            [
                ("1. Occurrence Details & Intimation", [
                    "Date & Time of Occurrence: 18-Oct-2026 at approx 02:30 Hours (Midnight)",
                    "Date & Time Reported at Thana: 18-Oct-2026 at 04:15 Hours",
                    "Location of Accident: Km 78.4, Old Mumbai-Pune National Corridor, near Urse Toll Plaza",
                    "Jurisdiction: Talegaon Dabhade Police Station, Sub-Division Dehu Road, Pune Rural",
                ]),
                ("2. Vehicle and Driver Statements", [
                    "Vehicle: TATA PRIMA Goods Truck Reg. No. MH-12-AB-1234 (14-Wheeler)",
                    "Driver on Duty: Sunil Baban Shinde, resident of Talegaon Dabhade (DL #MH-14-20150089123)",
                    "Cleaner on Duty: Rameshwar Pandit, resident of Chakan, Pune",
                    "Incident Brief: Vehicle carrying packaged FMCG cargo was proceeding toward Pune depot.",
                    "At Km 78.4, mechanical steering linkage joint detached unexpectedly. Driver attempted emergency",
                    "braking; vehicle struck the highway crash barrier and overturned onto left earthen shoulder.",
                ]),
                ("3. Investigation Officer Findings & MLC Check", [
                    "Casualties / Fatalities: NIL. Driver sustained superficial lacerations on left forearm.",
                    "Medical Examination: Examined at Talegaon Primary Health Centre (MLC #2026/891).",
                    "Alcohol Breathalyzer Result: 0.00 mg/100ml (Negative - No intoxication detected).",
                    "Compromise / Third Party Property: Minor barrier damage noted by MSRDC road patrol.",
                    "Investigating Officer: PSI K. D. Jadhav (Buckle #8812), Talegaon Dabhade Police Station",
                ]),
            ]
        )

        # 4. National Permit & Fitness
        create_pdf(
            os.path.join(docs_dir, "National_Goods_Permit_and_Fitness.pdf"),
            "FORM 48 - NATIONAL PERMIT FOR GOODS CARRIAGE",
            "Ministry of Road Transport and Highways (MoRTH) | State of Maharashtra",
            (20, 90, 80),
            [
                ("1. National Permit Specifications", [
                    "Permit Number: NP/MH/2023/88921-A           Permit Type: ALL INDIA NATIONAL GOODS PERMIT",
                    "Permit Holder: RAMESH KUMAR TRANSPORTS      Authorized Vehicle: MH-12-AB-1234",
                    "Permit Valid From: 10-Jan-2023              Permit Valid Upto: 09-Jan-2028",
                    "States Authorized: MAHARASHTRA, GUJARAT, MADHYA PRADESH, KARNATAKA, GOA, DELHI-NCR",
                ]),
                ("2. Authorization & Consolidated Fee Status", [
                    "Authorization Number: AUTH-MH-2026-44101    Valid Upto: 31-Dec-2026",
                    "National Permit Consolidated Fee: Rs. 16,500 Paid Online (Receipt #MORTH9988123)",
                    "Gross Vehicle Weight Authorized: 40,000 kg",
                ]),
                ("3. Certificate of Fitness", [
                    "Fitness Certificate Number: FC-PUNE-HGV-77291 Issued by: RTO Pune",
                    "Date of Last Inspection: 16-Sep-2025        Inspection Result: FIT & ROADWORTHY",
                    "Fitness Validity Expiry: 15-Sep-2027",
                ]),
            ]
        )

        # 5. Weighbridge Slip (Overloading Check)
        create_pdf(
            os.path.join(docs_dir, "Talegaon_Weighbridge_Gross_Weight_Challan.pdf"),
            "OM SAI COMPUTERIZED ELECTRONIC WEIGHBRIDGE",
            "Talegaon Industrial Gate Corridor | Government Certified Weigh Station #PUN-402",
            (110, 60, 10),
            [
                ("1. Weighbridge Slip Particulars", [
                    "Slip Reference Number: WB-2026-10-8812      Date: 18-Oct-2026",
                    "Weigh-In Timestamp: 01:45:12 AM (approx 45 minutes prior to reported incident)",
                    "Vehicle Number: MH-12-AB-1234              Operator Code: OP-04 (B. Gawli)",
                ]),
                ("2. Weight Measurement Breakdown", [
                    "Gross Vehicle Weight (Recorded):   38,450 kg",
                    "Tare / Unladen Truck Weight:       11,200 kg",
                    "Net Cargo Weight:                  27,250 kg",
                    "Permissible GVW Regulatory Limit:  40,000 kg",
                    "OVERLOADING EVALUATION:            NIL OVERLOAD (Safe margin: 1,550 kg under limit)",
                ]),
                ("3. Consignment Manifest", [
                    "Cargo Manifest: Packaged FMCG Consumer Goods (Soap, Detergent, Food Cartons)",
                    "Consignor: Hindustan Logistics Hub, Bhiwandi | Consignee: Metro Mega Depot, Chakan",
                    "Challan / E-Way Bill Number: 8812-9901-4451 (Active in GST E-Way system)",
                ]),
            ]
        )

        # 6. Garage Damage Estimate
        create_pdf(
            os.path.join(docs_dir, "Apex_Heavy_Motors_Repair_Estimate.pdf"),
            "APEX COMMERCIAL BODY & CHASSIS WORKS",
            "Authorized Heavy Vehicle Collision Repair Facility | Chakan MIDC, Pune - 410501",
            (80, 20, 100),
            [
                ("1. Repair Assessment Particulars", [
                    "Estimate Reference: APEX/EST/2026/10-449    Estimate Date: 19-Oct-2026",
                    "Insured: Ramesh Kumar Transports            Vehicle: TATA PRIMA 4028.S (MH-12-AB-1234)",
                    "Insurer: ICICI Lombard General Insurance    Surveyor Code: ER-DESHMUKH-882",
                ]),
                ("2. Itemized Parts & Material Estimate", [
                    "1. Front bumper assembly & heavy steel crash bar (OEM Tata):      Rs.  48,000.00",
                    "2. Radiator core, intercooler & cowl bracket assembly:            Rs.  65,000.00",
                    "3. Left front steering tie-rod & kingpin hub rebuild kit:          Rs.  34,500.00",
                    "4. Cabin left door shell, quarter glass & laminated windshield:    Rs.  72,000.00",
                    "5. Front semi-elliptical leaf spring suspension bracket cluster:   Rs.  38,500.00",
                    "6. Power steering gearbox casing & hydraulic fluid reservoir:       Rs.  32,000.00",
                    "SUBTOTAL PARTS:                                                    Rs. 2,90,000.00",
                ]),
                ("3. Labor, Alignment & Towing", [
                    "Chassis pulling, cabin alignment, spray painting & dismantling:  Rs.  75,000.00",
                    "Highway crane recovery & towing charges (Talegaon to Chakan):      Rs.  20,000.00",
                    "TOTAL ESTIMATED CLAIM COST:                                        Rs. 3,85,000.00",
                ]),
                ("4. Technical Surveyor Remarks", [
                    "Physical damage correlates with impact on highway guardrail and rollover onto soft shoulder.",
                    "No old welded cracks or rust patina found on steering tie-rod fracture point.",
                ]),
            ]
        )

        # Generate 3 Screenshots
        create_mock_png(
            os.path.join(shots_dir, "odometer_and_chassis_punch.png"),
            480, 270, (40, 50, 70), "Odometer 142890km & Chassis MAT448021N7M12345"
        )
        create_mock_png(
            os.path.join(shots_dir, "cabin_crush_and_steering_rod.png"),
            480, 270, (80, 30, 30), "Cabin Impact & Steering Rod Damage"
        )
        create_mock_png(
            os.path.join(shots_dir, "driver_face_and_badge.png"),
            480, 270, (30, 80, 50), "Driver Sunil Shinde with Badge B-992144"
        )

    print("All demo insurance documents and screenshots created successfully!")

if __name__ == "__main__":
    main()
