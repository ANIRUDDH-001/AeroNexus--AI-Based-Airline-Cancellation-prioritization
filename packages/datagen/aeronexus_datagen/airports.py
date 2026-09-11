"""Indian airport catalogue for the synthetic network. Coordinates are approximate (good enough for
great-circle block times); hubs are listed in priority order and match IndiGo's main bases.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AirportSeed:
    code: str
    name: str
    lat: float
    lon: float


HUBS: list[AirportSeed] = [
    AirportSeed("DEL", "Delhi", 28.5562, 77.1000),
    AirportSeed("BOM", "Mumbai", 19.0896, 72.8656),
    AirportSeed("BLR", "Bengaluru", 13.1986, 77.7066),
    AirportSeed("HYD", "Hyderabad", 17.2403, 78.4294),
    AirportSeed("MAA", "Chennai", 12.9941, 80.1709),
    AirportSeed("CCU", "Kolkata", 22.6547, 88.4467),
]

SPOKES: list[AirportSeed] = [
    AirportSeed("AMD", "Ahmedabad", 23.0772, 72.6347),
    AirportSeed("PNQ", "Pune", 18.5821, 73.9197),
    AirportSeed("GOI", "Goa (Dabolim)", 15.3808, 73.8314),
    AirportSeed("COK", "Kochi", 10.1520, 76.4019),
    AirportSeed("JAI", "Jaipur", 26.8242, 75.8122),
    AirportSeed("LKO", "Lucknow", 26.7606, 80.8893),
    AirportSeed("PAT", "Patna", 25.5913, 85.0880),
    AirportSeed("GAU", "Guwahati", 26.1061, 91.5859),
    AirportSeed("IXC", "Chandigarh", 30.6735, 76.7885),
    AirportSeed("SXR", "Srinagar", 33.9871, 74.7742),
    AirportSeed("TRV", "Thiruvananthapuram", 8.4821, 76.9201),
    AirportSeed("VNS", "Varanasi", 25.4524, 82.8593),
    AirportSeed("BBI", "Bhubaneswar", 20.2444, 85.8178),
    AirportSeed("NAG", "Nagpur", 21.0922, 79.0472),
    AirportSeed("IDR", "Indore", 22.7218, 75.8011),
    AirportSeed("RPR", "Raipur", 21.1804, 81.7388),
    AirportSeed("IXB", "Bagdogra", 26.6812, 88.3286),
    AirportSeed("UDR", "Udaipur", 24.6177, 73.8961),
    AirportSeed("ATQ", "Amritsar", 31.7096, 74.7973),
    AirportSeed("DED", "Dehradun", 30.1897, 78.1803),
    AirportSeed("IXR", "Ranchi", 23.3143, 85.3217),
    AirportSeed("VTZ", "Visakhapatnam", 17.7212, 83.2245),
    AirportSeed("BHO", "Bhopal", 23.2875, 77.3374),
    AirportSeed("GOX", "Goa (Mopa)", 15.7440, 73.8620),
    AirportSeed("IXJ", "Jammu", 32.6891, 74.8374),
    AirportSeed("IXL", "Leh", 34.1359, 77.5465),
    AirportSeed("IXA", "Agartala", 23.8870, 91.2404),
    AirportSeed("IMF", "Imphal", 24.7600, 93.8967),
    AirportSeed("DIB", "Dibrugarh", 27.4839, 95.0169),
    AirportSeed("JLR", "Jabalpur", 23.1778, 80.0520),
    AirportSeed("IXE", "Mangaluru", 12.9613, 74.8901),
    AirportSeed("HBX", "Hubballi", 15.3617, 75.0849),
    AirportSeed("CJB", "Coimbatore", 11.0300, 77.0434),
    AirportSeed("IXM", "Madurai", 9.8345, 78.0934),
    AirportSeed("TRZ", "Tiruchirappalli", 10.7654, 78.7097),
    AirportSeed("VGA", "Vijayawada", 16.5304, 80.7968),
    AirportSeed("TIR", "Tirupati", 13.6325, 79.5433),
    AirportSeed("BDQ", "Vadodara", 22.3362, 73.2263),
    AirportSeed("RAJ", "Rajkot", 22.3092, 70.7795),
    AirportSeed("STV", "Surat", 21.1141, 72.7418),
    AirportSeed("IXU", "Aurangabad", 19.8627, 75.3981),
    AirportSeed("GAY", "Gaya", 24.7443, 84.9512),
    AirportSeed("IXD", "Prayagraj", 25.4401, 81.7339),
    AirportSeed("AJL", "Aizawl", 23.8406, 92.6197),
]

ALL: list[AirportSeed] = HUBS + SPOKES
BY_CODE: dict[str, AirportSeed] = {a.code: a for a in ALL}
