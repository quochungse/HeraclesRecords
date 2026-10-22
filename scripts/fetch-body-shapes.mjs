/**
 * Regenerates `src/calendar/bodyShapes.ts` from the `react-native-body-highlighter`
 * package (MIT).
 *
 * The exercise picker draws a human figure beside each Body part and Muscle
 * filter. The figure is that package's artwork — a body outline per view plus a
 * fill path per muscle group — and this script is how it gets into the repo.
 *
 * **The output is committed, and a build never runs this.** Same rule as
 * `fonts:fetch`: the app must build and run with no network, so the path data
 * lives in a source file rather than in `node_modules`. The package is not a
 * dependency of this project; it is pulled here, read, and thrown away.
 *
 * Run: npm run body-shapes:fetch
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE = "react-native-body-highlighter";
const VERSION = "3.2.0";
const OUT = join(ROOT, "src", "calendar", "bodyShapes.ts");

/**
 * The slugs the picker needs, and nothing else.
 *
 * The package draws a whole body from its parts — hands, knees, hair — but the
 * figure here is the outline filled solid with one muscle group lit on top, so
 * every other slug would be bytes the renderer never paints. Both views are
 * taken for each slug that has both: a body part lights whichever view shows
 * more of it, so "Arms" needs triceps from the front and "Legs" needs
 * adductors from the back.
 */
const WANTED = [
  "chest",
  "upper-back",
  "trapezius",
  "lower-back",
  "deltoids",
  "biceps",
  "triceps",
  "forearm",
  "abs",
  "obliques",
  "gluteal",
  "quadriceps",
  "hamstring",
  "adductors",
  "calves",
  "neck"
];

/**
 * The back view's buttocks and hips, drawn for this app on the package's frame
 * for react-native-body-highlighter@3.2.0 (2026-10-22), left then right.
 *
 * The package draws each buttock as the gluteus maximus and a small wedge
 * above it, the top of the gluteus medius; alone, the wedge read as an upper
 * buttock, while the abductors are the muscles down the side of the hip. So:
 *
 *   - `ABDUCTOR_PATHS` run from the package's wedge round the outside of the
 *     buttock and down the hip to the top of the thigh, 3 units in from the
 *     outline;
 *   - `GLUTEUS_MAXIMUS_PATHS` are the package's maximus with its outer edge
 *     drawn in by 5 units down the hip (tapered at both ends), which is the
 *     room the abductors take — between the maximus and the outline there were
 *     only ~15 units, too little for a band that reads.
 *
 * Both were sampled off the package's own paths and outline, walked at an even
 * step (4 units, 6 for the maximus) and joined with a Catmull-Rom spline, so
 * they follow the artwork they sit in, and they keep a 5-unit gap like the
 * package's own muscles. They belong to this version's
 * frame: the script refuses a package whose gluteal is not two paths a side.
 */
const ABDUCTOR_PATHS = [
  "M1045.1 626.2C1046.2 626.9 1047.5 628.0 1047.9 628.9C1048.4 629.8 1048.4 630.8 1047.8 631.5C1047.1 632.1 1045.2 632.2 1043.9 632.5C1042.7 632.9 1041.4 633.3 1040.1 633.7C1038.8 634.1 1037.6 634.4 1036.3 634.9C1035.0 635.3 1033.8 635.7 1032.5 636.1C1031.3 636.6 1030.0 637.0 1028.8 637.5C1027.5 638.0 1026.3 638.5 1025.1 639.0C1023.9 639.5 1022.6 640.1 1021.4 640.7C1020.3 641.2 1019.1 641.9 1017.9 642.5C1016.7 643.1 1015.6 643.8 1014.5 644.5C1013.3 645.2 1012.2 645.9 1011.1 646.7C1010.0 647.4 1008.9 648.2 1007.8 649.0C1006.8 649.8 1005.8 650.6 1004.8 651.5C1003.8 652.4 1003.0 653.5 1002.1 654.4C1001.2 655.4 1000.2 656.4 999.3 657.3C998.4 658.3 997.5 659.3 996.6 660.3C995.7 661.2 994.8 662.2 993.9 663.2C993.0 664.1 992.1 665.1 991.2 666.1C990.3 667.1 989.3 668.0 988.4 669.0C987.6 670.0 986.9 671.2 986.2 672.3C985.4 673.4 984.7 674.5 983.9 675.6C983.2 676.7 982.4 677.8 981.7 678.9C981.0 680.0 980.4 681.2 979.8 682.4C979.3 683.6 978.7 684.8 978.3 686.1C977.8 687.3 977.4 688.6 977.1 689.9C976.8 691.2 976.6 692.5 976.5 693.8C976.4 695.2 976.3 696.5 976.3 697.8C976.3 699.2 976.3 700.5 976.4 701.8C976.5 703.1 976.7 704.5 976.8 705.8C977.0 707.1 977.2 708.4 977.4 709.7C977.7 711.0 978.0 712.3 978.3 713.6C978.6 714.9 978.9 716.2 979.2 717.5C979.5 718.8 979.9 720.1 980.1 721.4C980.2 722.7 980.6 724.3 980.2 725.4C979.9 726.5 978.9 727.3 978.0 728.1C977.0 728.9 975.8 729.6 974.6 730.1C973.3 730.6 972.0 730.9 970.7 731.1C969.4 731.2 967.9 731.3 966.7 731.0C965.4 730.8 964.1 730.3 963.2 729.6C962.3 728.9 961.5 727.8 961.2 726.7C961.0 725.5 961.5 724.0 961.7 722.7C961.9 721.4 962.1 720.1 962.2 718.7C962.4 717.4 962.5 716.1 962.7 714.8C962.8 713.5 963.0 712.1 963.1 710.8C963.3 709.5 963.5 708.2 963.6 706.8C963.8 705.5 963.9 704.2 964.1 702.9C964.2 701.6 964.4 700.2 964.5 698.9C964.7 697.6 964.9 696.3 965.1 695.0C965.2 693.6 965.3 692.3 965.5 691.0C965.7 689.7 965.9 688.4 966.1 687.0C966.3 685.7 966.5 684.4 966.7 683.1C967.0 681.8 967.2 680.5 967.4 679.2C967.6 677.9 967.9 676.6 968.1 675.2C968.4 673.9 968.6 672.6 968.9 671.3C969.1 670.0 969.4 668.7 969.6 667.4C969.9 666.1 970.1 664.8 970.3 663.5C970.5 662.2 970.8 660.9 971.0 659.5C971.2 658.2 971.4 656.9 971.7 655.6C972.0 654.3 972.4 653.1 972.9 651.8C973.3 650.6 973.8 649.3 974.3 648.1C974.8 646.9 975.3 645.6 975.9 644.4C976.5 643.3 977.4 642.3 978.2 641.2C978.9 640.1 979.6 638.9 980.4 637.9C981.3 636.8 982.2 635.9 983.2 635.0C984.1 634.1 985.1 633.2 986.1 632.3C987.0 631.3 987.9 630.3 989.0 629.5C990.0 628.7 991.2 628.1 992.4 627.4C993.5 626.7 994.6 626.0 995.8 625.3C996.9 624.6 998.0 623.9 999.2 623.2C1000.3 622.5 1001.3 621.6 1002.5 621.0C1003.7 620.5 1005.0 620.0 1006.2 619.6C1007.5 619.3 1008.8 619.1 1010.2 619.0C1011.5 618.9 1012.8 618.8 1014.2 618.9C1015.5 618.9 1016.8 619.0 1018.1 619.1C1019.5 619.2 1020.8 619.4 1022.1 619.6C1023.4 619.8 1024.7 620.0 1026.0 620.3C1027.3 620.6 1028.6 620.9 1029.9 621.2C1031.2 621.5 1032.5 621.9 1033.8 622.2C1035.0 622.6 1036.3 623.0 1037.6 623.4C1038.8 623.8 1040.1 624.2 1041.4 624.7C1042.6 625.2 1044.0 625.5 1045.1 626.2Z",
  "M1117.9 631.0C1118.3 631.7 1120.5 631.8 1121.8 632.1C1123.1 632.5 1124.4 632.9 1125.7 633.2C1126.9 633.6 1128.2 634.0 1129.5 634.4C1130.8 634.7 1132.1 635.1 1133.3 635.6C1134.6 636.0 1135.9 636.4 1137.1 636.8C1138.4 637.3 1139.6 637.8 1140.9 638.3C1142.1 638.8 1143.3 639.3 1144.5 639.9C1145.8 640.4 1147.0 641.0 1148.1 641.6C1149.3 642.3 1150.5 642.9 1151.6 643.6C1152.7 644.4 1153.8 645.1 1154.9 645.9C1156.0 646.7 1157.1 647.5 1158.2 648.2C1159.3 649.0 1160.4 649.7 1161.4 650.6C1162.4 651.4 1163.3 652.5 1164.2 653.5C1165.1 654.5 1166.0 655.5 1166.9 656.4C1167.8 657.4 1168.7 658.4 1169.6 659.4C1170.5 660.3 1171.5 661.3 1172.4 662.3C1173.3 663.3 1174.2 664.3 1175.1 665.2C1176.0 666.2 1177.0 667.1 1177.8 668.2C1178.7 669.2 1179.5 670.2 1180.3 671.3C1181.1 672.4 1181.8 673.5 1182.6 674.6C1183.3 675.7 1184.1 676.8 1184.9 677.9C1185.6 679.0 1186.3 680.2 1186.9 681.4C1187.5 682.6 1188.0 683.8 1188.5 685.0C1188.9 686.3 1189.3 687.6 1189.6 688.9C1189.9 690.2 1190.1 691.5 1190.2 692.8C1190.4 694.2 1190.5 695.5 1190.5 696.8C1190.6 698.2 1190.6 699.5 1190.5 700.8C1190.5 702.2 1190.4 703.5 1190.3 704.8C1190.1 706.2 1189.9 707.5 1189.7 708.8C1189.5 710.1 1189.3 711.4 1189.0 712.7C1188.7 714.1 1188.3 715.3 1188.0 716.6C1187.7 717.9 1187.3 719.2 1187.1 720.5C1186.9 721.9 1186.7 723.4 1186.9 724.5C1187.1 725.7 1187.5 726.8 1188.3 727.7C1189.1 728.6 1190.5 729.3 1191.7 729.8C1192.9 730.4 1194.2 730.7 1195.5 730.9C1196.8 731.1 1198.2 731.2 1199.5 731.1C1200.8 731.0 1202.1 731.0 1203.3 730.5C1204.5 730.0 1206.0 729.1 1206.5 728.1C1207.0 727.0 1206.3 725.5 1206.2 724.1C1206.1 722.8 1205.9 721.5 1205.7 720.2C1205.6 718.8 1205.4 717.5 1205.2 716.2C1205.1 714.9 1204.9 713.5 1204.7 712.2C1204.6 710.9 1204.4 709.5 1204.2 708.2C1204.1 706.9 1203.9 705.6 1203.7 704.2C1203.6 702.9 1203.5 701.6 1203.4 700.3C1203.2 698.9 1203.1 697.6 1202.9 696.3C1202.8 694.9 1202.6 693.6 1202.4 692.3C1202.3 691.0 1202.1 689.6 1201.9 688.3C1201.7 687.0 1201.4 685.7 1201.2 684.4C1201.0 683.0 1200.9 681.7 1200.7 680.4C1200.5 679.1 1200.2 677.8 1200.0 676.4C1199.7 675.1 1199.5 673.8 1199.2 672.5C1198.9 671.2 1198.7 669.9 1198.4 668.6C1198.1 667.3 1197.8 666.0 1197.6 664.7C1197.3 663.4 1197.1 662.0 1196.9 660.7C1196.6 659.4 1196.4 658.1 1196.1 656.8C1195.9 655.5 1195.6 654.2 1195.2 652.9C1194.8 651.6 1194.2 650.4 1193.8 649.2C1193.3 647.9 1192.9 646.6 1192.3 645.4C1191.7 644.2 1190.9 643.2 1190.1 642.1C1189.4 641.0 1188.7 639.8 1187.9 638.8C1187.0 637.7 1186.2 636.7 1185.3 635.7C1184.4 634.8 1183.3 633.9 1182.4 633.0C1181.4 632.1 1180.5 631.1 1179.4 630.2C1178.4 629.4 1177.2 628.7 1176.1 628.0C1175.0 627.4 1173.8 626.7 1172.6 626.1C1171.5 625.4 1170.3 624.7 1169.1 624.1C1168.0 623.4 1166.8 622.7 1165.7 622.0C1164.5 621.4 1163.4 620.7 1162.1 620.2C1160.9 619.7 1159.6 619.5 1158.2 619.3C1156.9 619.1 1155.6 619.0 1154.2 619.0C1152.9 619.0 1151.6 619.1 1150.2 619.2C1148.9 619.3 1147.6 619.4 1146.3 619.6C1144.9 619.7 1143.6 619.9 1142.3 620.1C1141.0 620.3 1139.7 620.6 1138.3 620.9C1137.0 621.1 1135.7 621.5 1134.4 621.8C1133.2 622.1 1131.9 622.5 1130.6 622.9C1129.3 623.3 1128.0 623.7 1126.8 624.1C1125.5 624.6 1124.2 625.0 1123.1 625.7C1121.9 626.3 1120.7 627.1 1119.9 628.0C1119.0 628.9 1117.6 630.4 1117.9 631.0Z"
];

const GLUTEUS_MAXIMUS_PATHS = [
  "M1007.9 762.8C1006.5 761.5 1005.1 760.0 1003.8 758.5C1002.4 757.1 1001.1 755.6 999.8 754.0C998.5 752.5 997.2 751.0 996.0 749.4C994.8 747.8 993.7 746.2 992.5 744.5C991.4 742.9 990.2 741.2 989.3 739.5C988.3 737.7 987.4 736.0 986.8 734.1C986.3 732.2 986.1 730.1 985.8 728.2C985.6 726.2 985.6 724.2 985.3 722.2C985.0 720.2 984.6 718.3 984.2 716.4C983.7 714.4 983.1 712.5 982.8 710.6C982.4 708.6 982.0 706.6 981.8 704.6C981.5 702.7 981.3 700.7 981.3 698.7C981.3 696.7 981.4 694.7 981.7 692.7C982.0 690.7 982.5 688.8 983.2 686.9C983.8 685.0 984.7 683.2 985.6 681.4C986.6 679.7 987.8 678.1 988.9 676.5C990.0 674.8 991.2 673.2 992.4 671.6C993.5 670.0 994.7 668.3 996.0 666.8C997.2 665.3 998.6 663.8 1000.1 662.5C1001.6 661.1 1003.1 659.9 1004.7 658.7C1006.3 657.5 1008.0 656.5 1009.7 655.4C1011.4 654.4 1013.1 653.3 1014.9 652.3C1016.6 651.3 1018.3 650.4 1020.1 649.4C1021.9 648.5 1023.6 647.5 1025.4 646.6C1027.2 645.7 1029.0 644.8 1030.8 644.0C1032.6 643.1 1034.4 642.3 1036.2 641.5C1038.1 640.8 1039.9 640.0 1041.8 639.3C1043.7 638.6 1045.6 638.0 1047.5 637.5C1049.4 637.0 1051.4 636.4 1053.4 636.2C1055.3 636.0 1057.5 635.7 1059.3 636.3C1061.1 636.9 1062.6 638.4 1064.1 639.7C1065.5 641.1 1066.6 642.8 1067.8 644.4C1069.0 646.0 1070.3 647.5 1071.4 649.2C1072.6 650.8 1073.7 652.5 1074.6 654.2C1075.6 655.9 1076.5 657.7 1077.2 659.6C1077.9 661.5 1078.4 663.4 1078.8 665.4C1079.3 667.3 1079.6 669.3 1079.9 671.3C1080.1 673.2 1080.4 675.2 1080.6 677.2C1080.7 679.2 1080.9 681.2 1080.9 683.2C1081.0 685.2 1081.0 687.2 1081.0 689.2C1080.9 691.2 1080.8 693.2 1080.7 695.2C1080.6 697.2 1080.4 699.2 1080.3 701.1C1080.1 703.1 1079.9 705.1 1079.7 707.1C1079.5 709.1 1079.2 711.1 1078.9 713.0C1078.7 715.0 1078.4 717.0 1078.1 719.0C1077.7 720.9 1077.4 722.9 1077.0 724.9C1076.6 726.8 1076.2 728.8 1075.8 730.7C1075.4 732.7 1074.9 734.6 1074.4 736.6C1074.0 738.5 1073.6 740.5 1073.2 742.4C1072.9 744.4 1072.6 746.4 1072.4 748.4C1072.2 750.3 1072.1 752.3 1072.0 754.3C1071.9 756.3 1072.0 758.3 1072.0 760.3C1071.9 762.3 1072.2 764.4 1071.7 766.3C1071.2 768.2 1070.3 770.1 1069.0 771.6C1067.8 773.1 1066.0 774.3 1064.3 775.2C1062.5 776.1 1060.5 776.7 1058.6 777.1C1056.7 777.5 1054.7 777.7 1052.7 777.8C1050.7 777.8 1048.7 777.7 1046.7 777.4C1044.7 777.1 1042.8 776.5 1040.9 775.9C1039.0 775.4 1037.1 774.7 1035.2 774.1C1033.3 773.5 1031.4 772.8 1029.5 772.3C1027.6 771.7 1025.6 771.3 1023.7 770.8C1021.8 770.3 1019.7 770.0 1017.9 769.3C1016.0 768.6 1014.2 767.7 1012.6 766.6C1010.9 765.5 1009.4 764.2 1007.9 762.8Z",
  "M1124.1 776.6C1122.2 777.1 1120.2 777.5 1118.2 777.7C1116.3 777.8 1114.2 777.8 1112.2 777.7C1110.3 777.5 1108.2 777.2 1106.4 776.6C1104.5 776.0 1102.5 775.2 1100.9 774.1C1099.3 773.0 1097.7 771.5 1096.8 769.9C1095.8 768.2 1095.4 766.1 1095.0 764.2C1094.7 762.2 1094.8 760.2 1094.8 758.2C1094.8 756.2 1094.8 754.2 1094.8 752.2C1094.7 750.2 1094.7 748.2 1094.5 746.2C1094.3 744.2 1093.9 742.3 1093.5 740.3C1093.1 738.3 1092.6 736.4 1092.1 734.5C1091.7 732.5 1091.2 730.6 1090.8 728.6C1090.3 726.7 1090.0 724.7 1089.6 722.8C1089.3 720.8 1089.0 718.8 1088.7 716.8C1088.4 714.9 1088.2 712.9 1088.0 710.9C1087.7 708.9 1087.6 706.9 1087.4 704.9C1087.2 702.9 1087.0 700.9 1086.8 699.0C1086.7 697.0 1086.5 695.0 1086.4 693.0C1086.3 691.0 1086.2 689.0 1086.2 687.0C1086.2 685.0 1086.2 683.0 1086.3 681.0C1086.4 679.0 1086.6 677.0 1086.8 675.0C1087.0 673.0 1087.3 671.1 1087.6 669.1C1087.9 667.1 1088.2 665.1 1088.7 663.2C1089.2 661.3 1089.9 659.4 1090.7 657.6C1091.6 655.8 1092.7 654.1 1093.8 652.4C1094.8 650.7 1095.9 649.1 1097.1 647.4C1098.2 645.8 1099.3 644.1 1100.5 642.5C1101.7 640.9 1102.7 639.0 1104.3 637.8C1105.8 636.7 1107.8 635.9 1109.7 635.7C1111.6 635.4 1113.7 636.0 1115.6 636.4C1117.6 636.8 1119.5 637.5 1121.3 638.2C1123.2 638.8 1125.1 639.6 1127.0 640.3C1128.8 641.0 1130.7 641.7 1132.5 642.5C1134.4 643.3 1136.2 644.1 1138.0 644.9C1139.8 645.8 1141.6 646.7 1143.4 647.6C1145.2 648.5 1146.9 649.4 1148.7 650.4C1150.4 651.4 1152.1 652.4 1153.8 653.4C1155.5 654.5 1157.2 655.5 1158.9 656.6C1160.6 657.7 1162.4 658.7 1163.9 659.9C1165.5 661.2 1166.9 662.6 1168.3 664.0C1169.7 665.4 1171.1 666.9 1172.3 668.4C1173.6 670.0 1174.6 671.7 1175.8 673.3C1177.0 674.9 1178.3 676.4 1179.4 678.1C1180.5 679.7 1181.6 681.4 1182.5 683.2C1183.3 685.0 1184.0 686.9 1184.4 688.9C1184.9 690.8 1185.2 692.8 1185.4 694.8C1185.6 696.8 1185.6 698.8 1185.5 700.8C1185.4 702.8 1185.2 704.8 1185.0 706.7C1184.7 708.7 1184.3 710.7 1183.9 712.6C1183.4 714.6 1182.7 716.5 1182.3 718.4C1182.0 720.4 1181.9 722.4 1181.7 724.3C1181.4 726.3 1181.3 728.3 1181.0 730.3C1180.7 732.3 1180.5 734.3 1179.7 736.1C1179.0 738.0 1177.7 739.6 1176.6 741.3C1175.6 743.0 1174.5 744.6 1173.3 746.3C1172.1 747.9 1170.9 749.5 1169.7 751.0C1168.5 752.6 1167.2 754.2 1165.9 755.7C1164.6 757.2 1163.2 758.7 1161.9 760.1C1160.5 761.6 1159.1 763.0 1157.6 764.3C1156.1 765.6 1154.4 766.8 1152.7 767.7C1150.9 768.7 1149.0 769.4 1147.1 770.0C1145.2 770.5 1143.2 770.7 1141.3 771.2C1139.3 771.7 1137.4 772.3 1135.5 772.9C1133.6 773.5 1131.7 774.1 1129.8 774.8C1127.9 775.4 1126.1 776.1 1124.1 776.6Z"
];

const workDir = mkdtempSync(join(tmpdir(), "body-shapes-"));

function cleanup() {
  rmSync(workDir, { recursive: true, force: true });
}

try {
  console.log(`fetching ${PACKAGE}@${VERSION}…`);
  execFileSync("npm", ["pack", `${PACKAGE}@${VERSION}`, "--silent"], {
    cwd: workDir,
    stdio: ["ignore", "pipe", "inherit"]
  });
  const tarball = readdirSync(workDir).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack produced no tarball");
  execFileSync("tar", ["xzf", tarball], { cwd: workDir, stdio: "inherit" });

  const pkg = join(workDir, "package");
  const require = createRequire(join(pkg, "index.js"));
  const front = require("./dist/assets/bodyFront.js").bodyFront;
  const back = require("./dist/assets/bodyBack.js").bodyBack;
  const license = readFileSync(join(pkg, "LICENSE"), "utf8").trim();

  /*
   * The body outline is drawn by the wrapper component rather than filed under
   * a slug, so it is read out of the JSX by its accessibility label. Stroked
   * there; filled here, which is what turns it into a silhouette.
   */
  const wrapper = readFileSync(join(pkg, "dist", "components", "SvgMaleWrapper.js"), "utf8");
  const outlineOf = (side) => {
    const marker = `accessibilityLabel="male-body-outline-${side}"`;
    const at = wrapper.indexOf(marker);
    if (at < 0) throw new Error(`no outline for the ${side} view`);
    const open = wrapper.lastIndexOf(' d="', at);
    const close = wrapper.indexOf('"', open + 4);
    if (open < 0 || close < 0) throw new Error(`could not read the ${side} outline path`);
    return wrapper.slice(open + 4, close);
  };

  const shapesOf = (list) => {
    const out = {};
    for (const entry of list) {
      if (!WANTED.includes(entry.slug)) continue;
      const paths = [...(entry.path?.left ?? []), ...(entry.path?.right ?? [])];
      if (paths.length > 0) out[entry.slug] = paths;
    }
    return out;
  };

  const shapes = { front: shapesOf(front), back: shapesOf(back) };

  /*
   * The package's gluteal slug is two paths a side, the maximus and the top
   * of the gluteus medius; both are replaced by the shapes drawn above.
   */
  const gluteal = back.find((entry) => entry.slug === "gluteal");
  for (const side of ["left", "right"]) {
    if ((gluteal?.path?.[side] ?? []).length !== 2) {
      throw new Error(`the ${side} gluteal is no longer two paths: redraw GLUTEUS_MAXIMUS_PATHS and ABDUCTOR_PATHS`);
    }
  }
  shapes.back = Object.fromEntries(Object.entries(shapes.back).flatMap(([slug, paths]) =>
    slug === "gluteal"
      ? [["gluteal", GLUTEUS_MAXIMUS_PATHS], ["gluteus-medius", ABDUCTOR_PATHS]]
      : [[slug, paths]]
  ));
  const missing = WANTED.filter(
    (slug) => !shapes.front[slug] && !shapes.back[slug]
  );
  if (missing.length > 0) {
    throw new Error(`the package no longer carries: ${missing.join(", ")}`);
  }

  const banner = `/**
 * Human-figure artwork for the exercise picker's Body part and Muscle filters.
 *
 * **Generated. Do not edit — run \`npm run body-shapes:fetch\`.**
 *
 * Taken from ${PACKAGE}@${VERSION}, which is not a dependency of this
 * project: the paths are copied in so the app builds and runs with no network,
 * the same reason the three typefaces are committed under src/assets/fonts.
 * Only the muscle groups this app files exercises under are kept, plus
 * the body outline for each view — the figure is that outline filled solid
 * with one group lit on top, so the package's other slugs (hands, knees, hair)
 * would be bytes nothing paints. The back view's gluteal (the maximus) and
 * gluteus-medius (the abductors, down the side of the hip) are drawn for this
 * app on the package's frame — see scripts/fetch-body-shapes.mjs.
 *
 * Upstream: https://github.com/HichamELBSI/react-native-body-highlighter
 *
 * ---------------------------------------------------------------------------
${license.split("\n").map((line) => ` * ${line}`.trimEnd()).join("\n")}
 * ---------------------------------------------------------------------------
 */

export type BodyView = "front" | "back";

/** The package's own frames. The back view is offset one body to the right. */
export const BODY_VIEW_BOX: Readonly<Record<BodyView, string>> = {
  front: "0 0 724 1448",
  back: "724 0 724 1448"
};

/** The silhouette. Stroked upstream; filled here. */
export const BODY_OUTLINE: Readonly<Record<BodyView, string>> = {
  front: ${JSON.stringify(outlineOf("front"))},
  back: ${JSON.stringify(outlineOf("back"))}
};

/** Fill paths per muscle slug, per view. A slug is absent from a view it has none on. */
export const BODY_SHAPES: Readonly<Record<BodyView, Readonly<Record<string, readonly string[]>>>> = ${JSON.stringify(shapes, null, 2)};
`;

  writeFileSync(OUT, banner);
  const bytes = Buffer.byteLength(banner);
  const counts = Object.entries(shapes)
    .map(([view, slugs]) => `${view} ${Object.keys(slugs).length}`)
    .join(", ");
  console.log(`wrote src/calendar/bodyShapes.ts — ${counts} slugs, ${(bytes / 1024).toFixed(1)} kB`);
} finally {
  cleanup();
}
